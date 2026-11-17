const { randomUUID } = require('node:crypto');
const id = () => randomUUID();
async function insert(c,table,values) {
  const keys=Object.keys(values);
  await c.execute('INSERT INTO `'+table+'` ('+keys.map(k=>'`'+k+'`').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',Object.values(values));
}
async function fixture(c,{playing=true,totalRounds=1,withRule=false}={}) {
  const f={tour:id(),type:id(),round:id(),match:id(),game:id(),players:[id(),id()],entrants:[id(),id()],allocations:[id(),id()],slots:[id(),id()],participants:[id(),id()],start:'2030-01-01 12:00:00.000',end:'2030-01-01 12:10:00.000',finish:'2030-01-01 12:01:00.000'};
  for(const player of f.players) await insert(c,'player',{player_id:player,username:player,_password:'test-hash-placeholder'});
  await insert(c,'tourtype',{tourType_id:f.type,_name:f.type.slice(0,20),_description:'Individual competition'});
  const at=ms=>new Date(Date.parse('2030-01-01T12:00:00Z')+ms).toISOString().replace('T',' ').replace('Z','');
  await insert(c,'tournament',{tournament_id:f.tour,tourtypeID:f.type,tour_name:f.tour,tour_version:1,number_of_teams:0,number_of_players:2,tour_start_day:f.start,tour_end_day:at((totalRounds-1)*660000+600000),registration_opens_at:'2029-12-01 00:00:00',registration_closes_at:'2029-12-31 00:00:00'});
  await insert(c,'tournament_configuration',{tournament_id:f.tour,format_code:'SWISS',format_version:'custom-swiss-1',total_rounds:totalRounds,maximum_entrants:16,match_duration_ms:600000,inter_round_gap_ms:60000,pairing_random_seed:id(),tiebreak_policy_version:'platform-swiss-1',policy_parameters:'{}',configuration_hash:'a'.repeat(64)});
  f.rounds=[f.round];
  for(let number=1;number<=totalRounds;number++) {
    const round=number===1?f.round:id();if(number>1)f.rounds.push(round);
    await insert(c,'tournament_round',{round_id:round,tournament_id:f.tour,round_number:number,scheduled_start_at:at((number-1)*660000),hard_deadline_at:at((number-1)*660000+600000)});
  }
  if(withRule) {
    f.rule=id();f.ruleConsideration=id();
    await insert(c,'ruleset',{ruleset_id:f.rule,formation_date:'2029-01-01 00:00:00',description:'Fixed tournament rule'});
    await insert(c,'tournament_rules',{tournament_rules_id:f.ruleConsideration,rulesetID:f.rule,rule_consideration_date:'2029-01-01 00:00:00'});
    await insert(c,'this_tournament_rules',{this_tournament_rules_id:id(),tournamentID:f.tour,tournament_rulesID:f.ruleConsideration});
  }
  await c.execute('UPDATE tournament_configuration SET frozen_at=? WHERE tournament_id=?',['2029-12-01 00:00:00',f.tour]);
  await c.execute("UPDATE tournament SET status='REGISTRATION_OPEN' WHERE tournament_id=?",[f.tour]);
  for(let i=0;i<2;i++) {
    await insert(c,'tournament_entrant',{entrant_id:f.entrants[i],tournament_id:f.tour,registered_at:'2029-12-15 00:00:00',seed_number:i+1});
    await insert(c,'tournament_player_registration',{entrant_id:f.entrants[i],tournament_id:f.tour,player_id:f.players[i]});
    await insert(c,'tournament_round_allocation',{allocation_id:f.allocations[i],tournament_id:f.tour,round_id:f.round,entrant_id:f.entrants[i],allocation_type:'MATCH'});
  }
  await insert(c,'tournament_match',{match_id:f.match,tournament_id:f.tour,round_id:f.round,board_number:1});
  for(let i=0;i<2;i++) await insert(c,'tournament_match_slot',{slot_id:f.slots[i],match_id:f.match,tournament_id:f.tour,round_id:f.round,allocation_id:f.allocations[i],entrant_id:f.entrants[i],color:i?'BLACK':'WHITE'});
  const [low,high]=[...f.entrants].sort();
  await insert(c,'tournament_opponent_pair',{tournament_id:f.tour,lower_entrant_id:low,higher_entrant_id:high,match_id:f.match});
  await c.execute("UPDATE tournament_match SET status='WAITING' WHERE match_id=?",[f.match]);
  await c.execute("UPDATE tournament_round SET status='PAIRED',pairings_published_at=?,pairing_algorithm_version='custom-swiss-1',pairing_input_hash=?,pairing_input_version=1 WHERE round_id=?",['2029-12-31 00:00:00','b'.repeat(64),f.round]);
  await c.execute("UPDATE tournament SET status='READY' WHERE tournament_id=?",[f.tour]);
  if(playing) await start(c,f);
  return f;
}
async function start(c,f) {
  await c.execute("UPDATE tournament_round SET status='IN_PROGRESS',actual_started_at=? WHERE round_id=?",[f.start,f.round]);
  await c.execute("UPDATE tournament SET status='IN_PROGRESS' WHERE tournament_id=?",[f.tour]);
  await insert(c,'game_session',{game_session_id:f.game,origin:'TOURNAMENT',tournament_match_id:f.match,engine_ruleset_version:'legacy-king-capture-v1'});
  for(let i=0;i<2;i++) await insert(c,'game_participant',{participant_id:f.participants[i],game_session_id:f.game,color:i?'BLACK':'WHITE',player_id:f.players[i],tournament_match_id:f.match,entrant_id:f.entrants[i],slot_id:f.slots[i],first_joined_at:f.start});
  await c.execute("UPDATE tournament_match SET status='IN_PROGRESS',actual_started_at=? WHERE match_id=?",[f.start,f.match]);
  await c.execute("UPDATE game_session SET status='IN_PROGRESS',started_at=? WHERE game_session_id=?",[f.start,f.game]);
}
async function move(c,f,sequence) {
  await insert(c,'game_move',{move_id:id(),game_session_id:f.game,move_sequence:sequence,participant_id:f.participants[(sequence-1)%2],from_square:sequence%2?'e2':'e7',to_square:sequence%2?'e4':'e5',accepted_at:f.finish});
  await c.execute('UPDATE game_session SET current_move_sequence=?,side_to_move=? WHERE game_session_id=?',[sequence,sequence%2?'BLACK':'WHITE',f.game]);
}
async function result(c,f,{rated=true,reason='GAME_COMPLETED',outcome='WHITE_WIN',noGame=false}={}) {
  f.result=id(); f.settlement=id();
  const time=reason==='MATCH_DEADLINE'?f.end:reason.includes('NO_SHOW')?f.start:f.finish;
  await insert(c,'game_result',{result_id:f.result,context:'TOURNAMENT',tournament_match_id:f.match,game_session_id:noGame?null:f.game,outcome,reason,white_points:outcome==='DRAW'?0.5:outcome==='WHITE_WIN'?1:0,black_points:outcome==='DRAW'?0.5:outcome==='BLACK_WIN'?1:0,effective_at:time,recorded_at:time,rules_version:'platform-swiss-1'});
  const [[g]]=noGame?[ [{current_move_sequence:0}] ]:await c.execute('SELECT current_move_sequence FROM game_session WHERE game_session_id=?',[f.game]);
  await insert(c,'rating_settlement',{settlement_id:f.settlement,result_id:f.result,game_session_id:noGame?null:f.game,policy_version:'platform-elo-1',rated:rated?1:0,exclusion_reason:rated?null:'ADMINISTRATIVE_RESULT',move_count:g.current_move_sequence});
  return time;
}
async function settle(c,f,{rated=true,time=f.finish}={}) {
  if(rated) {
    for(let i=0;i<2;i++) await insert(c,'player_rating',{player_id:f.players[i]});
    for(let i=0;i<2;i++) await insert(c,'player_rating_change',{settlement_id:f.settlement,game_session_id:f.game,participant_id:f.participants[i],player_id:f.players[i],color:i?'BLACK':'WHITE',rating_before:1200,rating_after:i?1184:1216,rating_delta:i?-16:16,expected_score:0.5,player_rating_version:1});
    for(let i=0;i<2;i++) await c.execute('UPDATE player_rating SET rating=?,rated_games=1,wins=?,losses=?,updated_at=?,lock_version=1 WHERE player_id=?',[i?1184:1216,i?0:1,i?1:0,time,f.players[i]]);
  }
  await c.execute("UPDATE rating_settlement SET status='APPLIED',finalized_at=? WHERE settlement_id=?",[time,f.settlement]);
}
module.exports={id,insert,fixture,start,move,result,settle};
