const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
const {migrate}=require('../tools/migrate');
const {verify}=require('../tools/verify');
const {migrations,root}=require('../tools/sql');
const {id,insert,fixture,move,result,settle}=require('./fixtures');

const enabled=process.env.MYSQL_SCHEMA_TEST==='1';
const options={host:process.env.MYSQL_TEST_HOST??'127.0.0.1',port:Number(process.env.MYSQL_TEST_PORT??33379),user:process.env.MYSQL_TEST_USER??'root',password:process.env.MYSQL_TEST_PASSWORD??'',supportBigNumbers:true,bigNumberStrings:true};
const rejected=(operation,codes=['ER_NO_REFERENCED_ROW_2','ER_CHECK_CONSTRAINT_VIOLATED','ER_DUP_ENTRY','ER_SIGNAL_EXCEPTION'])=>assert.rejects(operation,e=>codes.includes(e.code));
test('MySQL 8.4 schema acceptance suite',{skip:!enabled,timeout:180000},async t=>{
  const admin=await mysql.createConnection(options);
  const db='chess_schema_test_'+id().replaceAll('-','').slice(0,12);
  const c=await mysql.createConnection(options);
  t.after(async()=>{try{await c.end();if(!/^chess_schema_test_[a-f0-9]{12}$/.test(db))throw new Error('Unsafe scratch schema name');await admin.query('DROP DATABASE `'+db+'`');}finally{await admin.end();}});
  const [[version]]=await admin.query('SELECT VERSION() version'); assert.match(version.version,/^8\.4\./);
  await admin.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  await c.query('USE `'+db+'`'); await c.query("SET time_zone='+00:00'");
  await migrate(c);
  await t.test('complete migration, preserved legacy tables, enforced checks and idempotent rerun',async()=>{
    await migrate(c);
    const report=await verify(c);assert.equal(report.migrations,6);assert.equal(report.integrityIssues,0);
    const legacy=JSON.parse(fs.readFileSync(path.join(root,'legacy-manifest.json'))).tables;
    const [tables]=await c.query('SHOW TABLES');const names=tables.map(r=>Object.values(r)[0]);
    assert.ok(legacy.every(name=>names.includes(name)));
    assert.ok(Number(report.foreign_keys)>70);assert.ok(Number(report.triggers_count)>40);
  });
  async function scenario(name,fn){await t.test(name,async()=>{await c.beginTransaction();try{await fn(c);}finally{await c.rollback();}});}
  await scenario('valid individual fixture, played result, Elo settlement and final shared ranking',async()=>{
    const f=await fixture(c);await move(c,f,1);await move(c,f,2);await result(c,f);await settle(c,f);
    await c.execute("UPDATE game_session SET status='FINALIZED',finished_at=? WHERE game_session_id=?",[f.finish,f.game]);
    await c.execute("UPDATE tournament_match SET status='FINALIZED',finalized_at=? WHERE match_id=?",[f.finish,f.match]);
    await c.execute("UPDATE tournament_round_allocation SET resolution_status='RESOLVED',resolved_at=? WHERE round_id=?",[f.finish,f.round]);
    await c.execute("UPDATE tournament_round SET status='COMPLETED',completed_at=? WHERE round_id=?",[f.finish,f.round]);
    for(let i=0;i<2;i++)await insert(c,'tournament_final_standing',{tournament_id:f.tour,entrant_id:f.entrants[i],final_rank:1,score:i?0:1,buchholz:0,sonneborn_berger:0,played_wins:i?0:1,tiebreak_policy_version:'platform-swiss-1',source_competition_version:0,finalized_at:f.finish});
    await c.execute("UPDATE tournament SET status='COMPLETED',completed_at=? WHERE tournament_id=?",[f.finish,f.tour]);
    assert.equal((await verify(c)).integrityIssues,0);
    const [history]=await c.execute('SELECT * FROM v_player_rating_history WHERE player_id=?',[f.players[0]]);assert.equal(history.length,1);assert.equal(history[0].rating_after,1216);
    const [scores]=await c.execute('SELECT points FROM v_tournament_score_ledger WHERE tournament_id=? ORDER BY points',[f.tour]);assert.deepEqual(scores.map(r=>Number(r.points)),[0,1]);
  });
  await scenario('no-show draw without a game session finalizes with an unrated decision',async()=>{
    const f=await fixture(c,{playing:false});
    await c.execute("UPDATE tournament_round SET status='IN_PROGRESS',actual_started_at=? WHERE round_id=?",[f.start,f.round]);
    await result(c,f,{rated:false,reason:'DOUBLE_NO_SHOW',outcome:'DRAW',noGame:true});await settle(c,f,{rated:false,time:f.start});
    await c.execute("UPDATE tournament_match SET status='FINALIZED',finalized_at=? WHERE match_id=?",[f.start,f.match]);
    await c.execute("UPDATE tournament_round_allocation SET resolution_status='RESOLVED',resolved_at=? WHERE round_id=?",[f.start,f.round]);
    assert.equal((await verify(c)).integrityIssues,0);
  });
  await scenario('cross-tournament registration, round and fixture references are rejected',async()=>{
    const a=await fixture(c),b=await fixture(c);
    await rejected(insert(c,'tournament_player_registration',{entrant_id:id(),tournament_id:a.tour,player_id:b.players[0]}));
    await rejected(insert(c,'tournament_match',{match_id:id(),tournament_id:a.tour,round_id:b.round,board_number:2}));
    await rejected(insert(c,'tournament_round_allocation',{allocation_id:id(),tournament_id:a.tour,round_id:b.round,entrant_id:a.entrants[0],allocation_type:'MATCH'}));
  });
  await scenario('duplicate registration and duplicate per-round allocation are rejected',async()=>{
    const f=await fixture(c);
    const e=id();await insert(c,'tournament_entrant',{entrant_id:e,tournament_id:f.tour,registered_at:'2029-12-15 00:00:00'});
    await rejected(insert(c,'tournament_player_registration',{entrant_id:e,tournament_id:f.tour,player_id:f.players[0]}),['ER_DUP_ENTRY']);
    await rejected(insert(c,'tournament_round_allocation',{allocation_id:id(),tournament_id:f.tour,round_id:f.round,entrant_id:f.entrants[0],allocation_type:'MATCH'}));
  });
  await scenario('frozen schedules/configuration and published slots cannot change',async()=>{
    const f=await fixture(c,{withRule:true});
    await rejected(c.execute('UPDATE tournament_round SET hard_deadline_at=? WHERE round_id=?',['2030-01-01 12:11:00',f.round]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE tournament_configuration SET reconnect_grace_ms=1 WHERE tournament_id=?',[f.tour]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('DELETE FROM tournament_match_slot WHERE slot_id=?',[f.slots[0]]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE tournament SET tour_start_day=? WHERE tournament_id=?',['2030-01-01 13:00:00',f.tour]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute("UPDATE tournament_round SET status='COMPLETED',completed_at=? WHERE round_id=?",[f.finish,f.round]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE ruleset SET description=? WHERE ruleset_id=?',['Changed rule',f.rule]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE tournament_rules SET rule_consideration_date=? WHERE tournament_rules_id=?',['2030-01-01 00:00:00',f.ruleConsideration]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.query("UPDATE tournament_format SET strategy_key='changed-strategy' WHERE format_code='SWISS'"),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('withdrawal is permanent and registration identity cannot be reassigned',async()=>{
    const f=await fixture(c);
    await c.execute("UPDATE tournament_entrant SET registration_status='WITHDRAWN',withdrawn_at=? WHERE entrant_id=?",[f.finish,f.entrants[0]]);
    await rejected(c.execute("UPDATE tournament_entrant SET registration_status='REGISTERED',withdrawn_at=NULL WHERE entrant_id=?",[f.entrants[0]]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE tournament_player_registration SET player_id=? WHERE entrant_id=?',[f.players[1],f.entrants[0]]),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('participant identity/color must match the tournament slot and account',async()=>{
    const f=await fixture(c),g=id();
    await insert(c,'game_session',{game_session_id:g,origin:'QUICK_PLAY',engine_ruleset_version:'legacy-king-capture-v1'});
    await rejected(insert(c,'game_participant',{participant_id:id(),game_session_id:g,color:'WHITE',player_id:f.players[0],tournament_match_id:f.match,entrant_id:f.entrants[0],slot_id:f.slots[0]}));
    await rejected(c.execute('UPDATE game_participant SET player_id=? WHERE participant_id=?',[f.players[1],f.participants[0]]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE game_session SET draw_offer_participant_id=?,draw_offered_at=? WHERE game_session_id=?',[id(),f.finish,f.game]),['ER_NO_REFERENCED_ROW_2']);
  });
  await scenario('move journal enforces sequence, side, coordinates and append-only history',async()=>{
    const f=await fixture(c);
    await rejected(c.execute("UPDATE game_session SET side_to_move='BLACK' WHERE game_session_id=?",[f.game]),['ER_SIGNAL_EXCEPTION']);
    await rejected(insert(c,'game_move',{move_id:id(),game_session_id:f.game,move_sequence:1,participant_id:f.participants[1],from_square:'e7',to_square:'e5',accepted_at:f.finish}),['ER_SIGNAL_EXCEPTION']);
    await rejected(insert(c,'game_move',{move_id:id(),game_session_id:f.game,move_sequence:1,participant_id:f.participants[0],from_square:'z9',to_square:'e5',accepted_at:f.finish}),['ER_CHECK_CONSTRAINT_VIOLATED']);
    await move(c,f,1);
    await rejected(insert(c,'game_move',{move_id:id(),game_session_id:f.game,move_sequence:3,participant_id:f.participants[1],from_square:'e7',to_square:'e5',accepted_at:f.finish}),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('DELETE FROM game_move WHERE game_session_id=?',[f.game]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute('UPDATE game_move SET to_square=? WHERE game_session_id=?',['e3',f.game]),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('idempotency receipt cannot point to another session or duplicate a command',async()=>{
    const f=await fixture(c);await move(c,f,1);
    const receipt={game_session_id:f.game,participant_id:f.participants[0],command_id:'move-one',request_hash:'c'.repeat(64),accepted_move_sequence:1,response_payload:'{}'};
    await insert(c,'game_command_receipt',receipt);await rejected(insert(c,'game_command_receipt',receipt),['ER_DUP_ENTRY']);
    await rejected(c.execute('UPDATE game_command_receipt SET response_payload=? WHERE game_session_id=?',['{"changed":true}',f.game]),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('outcome/score mismatch, wrong result context and incorrect deadline are rejected',async()=>{
    const f=await fixture(c);await move(c,f,1);await move(c,f,2);
    const r={result_id:id(),context:'TOURNAMENT',tournament_match_id:f.match,game_session_id:f.game,outcome:'DRAW',reason:'DRAW_AGREEMENT',white_points:1,black_points:0,effective_at:f.finish,recorded_at:f.finish,rules_version:'v1'};
    await rejected(insert(c,'game_result',r),['ER_CHECK_CONSTRAINT_VIOLATED']);
    await rejected(insert(c,'game_result',{...r,result_id:id(),context:'QUICK_PLAY',tournament_match_id:null,white_points:0.5,black_points:0.5}),['ER_NO_REFERENCED_ROW_2']);
    await rejected(insert(c,'game_result',{...r,result_id:id(),reason:'MATCH_DEADLINE',white_points:0.5,black_points:0.5}),['ER_SIGNAL_EXCEPTION']);
    await result(c,f);await rejected(insert(c,'game_result',{...r,result_id:id(),outcome:'WHITE_WIN',reason:'GAME_COMPLETED',white_points:1,black_points:0}),['ER_DUP_ENTRY']);
    await rejected(c.execute("UPDATE game_result SET outcome='BLACK_WIN' WHERE result_id=?",[f.result]),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('partial Elo settlement cannot finalize and manual rating edits are rejected',async()=>{
    const f=await fixture(c);await move(c,f,1);await move(c,f,2);await result(c,f);
    await rejected(c.execute("UPDATE rating_settlement SET status='APPLIED',finalized_at=? WHERE settlement_id=?",[f.finish,f.settlement]),['ER_SIGNAL_EXCEPTION']);
    await rejected(c.execute("UPDATE game_session SET status='FINALIZED',finished_at=? WHERE game_session_id=?",[f.finish,f.game]),['ER_SIGNAL_EXCEPTION']);
    await insert(c,'player_rating',{player_id:f.players[0]});
    await rejected(c.execute('UPDATE player_rating SET rating=1500,rated_games=1,wins=1,lock_version=1 WHERE player_id=?',[f.players[0]]),['ER_SIGNAL_EXCEPTION']);
    const [[issues]]=await c.query("SELECT COUNT(*) n FROM v_schema_integrity_issues WHERE issue_code='RESULT_NOT_SETTLED'");assert.ok(Number(issues.n)>0);
  });
  await scenario('guest and same-account quick-play results cannot become rated',async()=>{
    const f=await fixture(c);
    for(const guest of [false,true]) {
      const q={game:id(),participants:[id(),id()],finish:f.finish};
      await insert(c,'game_session',{game_session_id:q.game,origin:'QUICK_PLAY',engine_ruleset_version:'legacy-king-capture-v1'});
      for(let i=0;i<2;i++)await insert(c,'game_participant',{participant_id:q.participants[i],game_session_id:q.game,color:i?'BLACK':'WHITE',player_id:guest&&i?null:f.players[0],guest_label:guest&&i?'Guest':null});
      await c.execute("UPDATE game_session SET status='IN_PROGRESS',started_at=? WHERE game_session_id=?",[f.start,q.game]);
      await move(c,q,1);await move(c,q,2);
      const rid=id();await insert(c,'game_result',{result_id:rid,context:'QUICK_PLAY',game_session_id:q.game,outcome:'WHITE_WIN',reason:'GAME_COMPLETED',white_points:1,black_points:0,effective_at:f.finish,recorded_at:f.finish,rules_version:'v1'});
      await rejected(insert(c,'rating_settlement',{settlement_id:id(),result_id:rid,game_session_id:q.game,policy_version:'platform-elo-1',rated:1,move_count:2}),['ER_SIGNAL_EXCEPTION']);
    }
  });
  await scenario('one full-point bye per round and no repeated bye; null awards are rejected',async()=>{
    const f=await fixture(c,{totalRounds:3});
    const allocation=(entrant,round,points)=>({allocation_id:id(),tournament_id:f.tour,round_id:round,entrant_id:entrant,allocation_type:'PAIRING_BYE',awarded_points:points});
    await rejected(insert(c,'tournament_round_allocation',allocation(f.entrants[0],f.rounds[1],null)),['ER_CHECK_CONSTRAINT_VIOLATED']);
    await insert(c,'tournament_round_allocation',allocation(f.entrants[0],f.rounds[1],1));
    await rejected(insert(c,'tournament_round_allocation',allocation(f.entrants[1],f.rounds[1],1)),['ER_DUP_ENTRY']);
    await rejected(insert(c,'tournament_round_allocation',allocation(f.entrants[0],f.rounds[2],1)),['ER_DUP_ENTRY']);
    await rejected(insert(c,'tournament_round_allocation',{...allocation(f.entrants[1],f.rounds[1],0.5),allocation_type:'REQUESTED_BYE'}),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('repeat opponents are rejected even in a later round',async()=>{
    const f=await fixture(c,{totalRounds:2}),match=id();
    await insert(c,'tournament_match',{match_id:match,tournament_id:f.tour,round_id:f.rounds[1],board_number:1});
    for(let i=0;i<2;i++) {
      const allocation=id();await insert(c,'tournament_round_allocation',{allocation_id:allocation,tournament_id:f.tour,round_id:f.rounds[1],entrant_id:f.entrants[i],allocation_type:'MATCH'});
      await insert(c,'tournament_match_slot',{slot_id:id(),match_id:match,tournament_id:f.tour,round_id:f.rounds[1],allocation_id:allocation,entrant_id:f.entrants[i],color:i?'WHITE':'BLACK'});
    }
    const [low,high]=[...f.entrants].sort();
    await rejected(insert(c,'tournament_opponent_pair',{tournament_id:f.tour,lower_entrant_id:low,higher_entrant_id:high,match_id:match}),['ER_DUP_ENTRY']);
    const emptyDraft=id();await insert(c,'tournament_match',{match_id:emptyDraft,tournament_id:f.tour,round_id:f.rounds[1],board_number:2});
    await c.execute('DELETE FROM tournament_match WHERE match_id=?',[emptyDraft]);
    await rejected(insert(c,'tournament_match',{match_id:id(),tournament_id:f.tour,round_id:f.round,board_number:2}),['ER_SIGNAL_EXCEPTION']);
  });
  await scenario('SQL rollback removes result and rating work together',async()=>{
    const f=await fixture(c);await move(c,f,1);await move(c,f,2);await c.query('SAVEPOINT before_result');await result(c,f);await settle(c,f);
    await c.query('ROLLBACK TO SAVEPOINT before_result');
    const [[r]]=await c.execute('SELECT COUNT(*) n FROM game_result WHERE tournament_match_id=?',[f.match]);assert.equal(Number(r.n),0);
    const [[p]]=await c.execute('SELECT COUNT(*) n FROM player_rating WHERE player_id IN (?,?)',f.players);assert.equal(Number(p.n),0);
  });
  await scenario('scheduler target cannot cross tournament boundaries and leases are coherent',async()=>{
    const a=await fixture(c),b=await fixture(c);
    await rejected(insert(c,'scheduled_action',{action_id:id(),action_type:'MATCH_DEADLINE',tournament_id:a.tour,round_id:b.round,match_id:b.match,due_at:a.end,deduplication_key:id()}));
    await rejected(insert(c,'scheduled_action',{action_id:id(),action_type:'REGISTRATION_CLOSE',tournament_id:a.tour,due_at:a.start,deduplication_key:id(),status:'CLAIMED'}),['ER_CHECK_CONSTRAINT_VIOLATED']);
  });
  await t.test('concurrent duplicate player registration yields one committed registration',async()=>{
    await c.beginTransaction();const f=await fixture(c);const p=id();await insert(c,'player',{player_id:p,username:p,_password:'test'});
    const entrants=[id(),id()];for(const entrant of entrants)await insert(c,'tournament_entrant',{entrant_id:entrant,tournament_id:f.tour,registered_at:'2029-12-15 00:00:00'});await c.commit();
    const a=await mysql.createConnection({...options,database:db}),b=await mysql.createConnection({...options,database:db});
    try {
      await a.beginTransaction();await b.beginTransaction();
      await insert(a,'tournament_player_registration',{entrant_id:entrants[0],tournament_id:f.tour,player_id:p});
      const losing=rejected(insert(b,'tournament_player_registration',{entrant_id:entrants[1],tournament_id:f.tour,player_id:p}),['ER_DUP_ENTRY']);
      await a.commit();await losing;await b.rollback();
      const [[n]]=await c.execute('SELECT COUNT(*) n FROM tournament_player_registration WHERE tournament_id=? AND player_id=?',[f.tour,p]);assert.equal(Number(n.n),1);
    } finally {await a.end();await b.end();}
  });
});

test('legacy adoption verifies schema, preserves data and detects changed migration checksums',{skip:!enabled,timeout:180000},async()=>{
  const a=await mysql.createConnection(options);const db='chess_schema_test_'+id().replaceAll('-','').slice(0,12);
  try {
    await a.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');await a.query('USE `'+db+'`');
    for(const s of migrations()[0].statements)await a.query(s);
    const p=id();await insert(a,'player',{player_id:p,first_name:'Existing',last_name:'Player',username:'existing-user',_password:'legacy-value'});
    const q=id(),tour=id(),type=id(),teams=[id(),id()],registered=[id(),id()],roster=[id(),id()],teamMatch=id(),board=id();
    await insert(a,'player',{player_id:q,first_name:'Other',last_name:'Player',username:'other-user',_password:'legacy-value'});
    await insert(a,'tourtype',{tourType_id:type,_name:'Team legacy',_description:'Existing tournament'});
    await insert(a,'tournament',{tournament_id:tour,tourtypeID:type,tour_name:tour,tour_version:1,number_of_teams:2,number_of_players:2,tour_start_day:'2030-01-01 12:00:00',tour_end_day:'2030-01-01 12:10:00'});
    for(let i=0;i<2;i++) {
      await insert(a,'teams',{team_id:teams[i],unique_name:teams[i].slice(0,25),team_name:'Legacy team '+i,number_of_players:1});
      await insert(a,'teamstate',{teamState_id:id(),teamsID:teams[i],playerID:i?q:p});
      await insert(a,'tourteams',{TourTeams_id:registered[i],tourID:tour,teamID:teams[i]});
      await insert(a,'tourteamstate',{TourTeamState_id:roster[i],tourteamID:registered[i],playerID:i?q:p});
    }
    await insert(a,'tourteam_matches',{TourTeamMatches_id:teamMatch,tourID:tour,tourteam1:registered[0],tourteam2:registered[1],start_time:'2030-01-01 12:00:00',end_time:'2030-01-01 12:10:00'});
    await insert(a,'tourteam_player_matches',{tourteam_player_matches_id:board,tourteam_matchID:teamMatch,player1:roster[0],player2:roster[1],start_time:'2030-01-01 12:00:00',time_period:600});
    await insert(a,'tourteam_player_match_details',{tourteam_player_match_details_id:id(),tourteam_player_matchID:board,white_pieces_player:roster[0],black_pieces_player:roster[1],winning_player:roster[0],losing_player:roster[1],playing_start_time:'2030-01-01 12:00:00',playing_end_time:'2030-01-01 12:01:00'});
    await insert(a,'tourteam_match_details',{tourteam_match_details_id:id(),tourteam_matchID:teamMatch,winner_team:registered[0],losing_team:registered[1]});
    await insert(a,'tournament_details',{tournament_details_id:id(),tourID:tour,winner_team:registered[0]});
    await insert(a,'tournament_match_moves',{tournament_match_moves_id:id(),ttPlayerMatchesID:board,tourTeamStateID:roster[0],piece_color:'WHITE',piece_name:'Pawn',tile:'e4'});
    await assert.rejects(migrate(a),/Nonempty database refused/);
    await migrate(a,{adoptLegacy:true});
    const [[row]]=await a.execute('SELECT username,_password FROM player WHERE player_id=?',[p]);assert.equal(row.username,'existing-user');assert.equal(row._password,'legacy-value');
    const [[scope]]=await a.execute('SELECT tourID,scheduled_start_at,start_time FROM tourteam_player_matches WHERE tourteam_player_matches_id=?',[board]);assert.equal(scope.tourID,tour);assert.equal(scope.scheduled_start_at,null);assert.equal(scope.start_time,'2030-01-01 12:00:00');
    await rejected(a.execute('UPDATE tourteamstate SET playerID=? WHERE TourTeamState_id=?',[q,roster[0]]),['ER_SIGNAL_EXCEPTION']);
    await rejected(a.execute('UPDATE tourteams SET teamID=? WHERE TourTeams_id=?',[teams[1],registered[0]]),['ER_SIGNAL_EXCEPTION']);
    await verify(a);
    await a.execute("UPDATE schema_migration SET checksum=? WHERE version='002'",['0'.repeat(64)]);
    await assert.rejects(migrate(a),/checksum/);
  } finally {await a.query('DROP DATABASE `'+db+'`');await a.end();}
});
test('unsafe legacy data is refused before extension DDL and can be reviewed then retried',{skip:!enabled,timeout:180000},async()=>{
  const c=await mysql.createConnection(options),db='chess_schema_test_'+id().replaceAll('-','').slice(0,12);
  try {
    await c.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');await c.query('USE `'+db+'`');
    for(const s of migrations()[0].statements)await c.query(s);
    const p=id();await insert(c,'player',{player_id:p,first_name:'Existing',last_name:'Player',username:'existing',_password:'legacy'});
    await insert(c,'player_history',{player_history_id:id(),playerID:p,matches_played:-1,tournaments_played:0});
    await assert.rejects(migrate(c,{adoptLegacy:true}),/preflight failed/);
    const [cols]=await c.query("SHOW COLUMNS FROM player LIKE '_password'");assert.equal(cols[0].Type,'varchar(15)');
    await c.query('UPDATE player_history SET matches_played=0');
    await migrate(c,{adoptLegacy:true});await verify(c);
  } finally {await c.query('DROP DATABASE `'+db+'`');await c.end();}
});
test('legacy adoption rejects missing foreign keys before adding tables',{skip:!enabled,timeout:180000},async()=>{
  const c=await mysql.createConnection(options),db='chess_schema_test_'+id().replaceAll('-','').slice(0,12);
  try {
    await c.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');await c.query('USE `'+db+'`');
    for(const s of migrations()[0].statements)await c.query(s);
    await c.query('ALTER TABLE player_contact DROP FOREIGN KEY fk_player_contact');
    await assert.rejects(migrate(c,{adoptLegacy:true}),/foreign keys differ/);
    const [[n]]=await c.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_session'");assert.equal(Number(n.n),0);
  } finally {await c.query('DROP DATABASE `'+db+'`');await c.end();}
});
test('generated standalone schema installs with the same verifiable journal',{skip:!enabled,timeout:180000},async()=>{
  const c=await mysql.createConnection(options),db='chess_schema_test_'+id().replaceAll('-','').slice(0,12);
  try {
    await c.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');await c.query('USE `'+db+'`');
    const {splitSql}=require('../tools/sql');
    for(const statement of splitSql(fs.readFileSync(path.join(root,'schema.sql'),'utf8')))await c.query(statement);
    await verify(c);await migrate(c);
  } finally {await c.query('DROP DATABASE `'+db+'`');await c.end();}
});
