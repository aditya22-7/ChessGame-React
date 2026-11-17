const Manager = require("./manager");
const queue = require("./queue");

class gameManager {
	#managerQueue = new queue();
	#activeGames = [];
	constructor({ ratings, clock = () => Date.now() } = {}) {
		this.ratings = ratings;
		this.clock = clock;
	}

	manager(socket) {
		console.log("Player Connected");
		socket.on("newgame", async (data) => {
			if (socket.side || socket.data.quickPlayJoining || socket.data.tournamentPlayerId || typeof data !== "string") return;
			socket.data.quickPlayJoining = true;
			try {
				let playerId = null;
				if (socket.request.session?.isAuth) playerId = await new Promise(resolve => {
					socket.request.session.reload(error => resolve(!error && socket.request.session?.isAuth ? socket.request.session.name : null));
				});
				if (!socket.connected || socket.side || socket.data.tournamentPlayerId) return;
				socket.ratingPlayerId = playerId;
				socket.name = playerId ?? data;
				this.init(socket);
			} finally { socket.data.quickPlayJoining = false; }
		});
		socket.on("end", () => {
			console.log("Player Disconnected");
			socket.disconnect(false);
		});
	}

	init(socket) {
		// Disconnected waiting players must not leave dead games in the queue.
		while (this.#managerQueue.isThereElement()) {
			const man = this.#managerQueue.dequeue();
			if (man.removed) continue;
			man.init(socket);
			this.activateGame(man);
			return;
		}
		const man = new Manager(this);
		man.init(socket);
		this.#managerQueue.enqueue(man);
	}

	activateGame(man) {
		this.#activeGames.push(man);
	}

	deactivateGame(man) {
		if (!man) return;
		const index = this.#activeGames.indexOf(man);
		if (index !== -1) this.#activeGames.splice(index, 1);
		man.removed = true;
	}
}

module.exports = gameManager;
