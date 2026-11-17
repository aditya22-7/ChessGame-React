import { asc } from "../utils/chess-utils";
import socketHandler from "./socket-handler";
import { API_URL } from '../infrastructure/api';

export let gameData = null;

async function ratingRequest(path, signal) {
	const response = await fetch(`${API_URL}/players/${path}`, {
		credentials: "include", signal,
	});
	if (!response.ok) throw new Error("Unable to load rating data");
	return response.json();
}
export const fetchPlayerRating = (playerId = "me", signal) =>
	ratingRequest(`${encodeURIComponent(playerId)}/rating`, signal);
export const fetchRatingHistory = (limit = 5, signal) =>
	ratingRequest(`me/rating-history?limit=${limit}`, signal);

export const checkLogin = (username, password, count) => {
	let response, error, promise;
	promise = fetch(`${API_URL}/auth`, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
		},
		referrerPolicy: "origin",
		body: JSON.stringify({
			username: username,
			password: password,
			count: count,
		}),
	})
		.then((res) => res.json())
		.then((res) => (response = res))
		.catch((err) => (error = err));
	return {
		read() {
			if (error) throw error;
			if (response) return response;
			throw promise;
		},
	};
};

export const checkLoginStatus = () => {
	let response, error, promise;
	promise = fetch(`${API_URL}/auth`, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
		},
		referrerPolicy: "origin",
	})
		.then((res) => res.json())
		.then((res) => (response = res))
		.catch((err) => (error = err));
	return {
		read() {
			if (error) throw error;
			if (response) return response;
			throw promise;
		},
	};
};

export const logout = async (callback) => {
	await fetch(`${API_URL}/logout`, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
		},
		referrerPolicy: "origin",
	}).then((res) => res.json());
	window.dispatchEvent(new Event('chess:unauthenticated'));
	callback();
};

export const initSocket = () => socketHandler.init();

export const disconnect = () => socketHandler.disconnect();

export const createNewGame = async (name, callback) => {
	const ret = await socketHandler.createNewGame(name);
	gameData = ret;
	callback(name, gameData.name);
};

export async function getPermittedTiles(row, col, callback) {
	const pt = await socketHandler.makeMoveFrom({ row: asc([row, 7]), col });
	callback(pt);
}

export async function getMove(callback) {
	const data = await socketHandler.getMove();
	callback(data);
}

export async function makeMove(row, col, callback) {
	const to = await socketHandler.makeMoveTo({ row: asc([row, 7]), col });
	callback(to);
}

export async function leaveGame(callback) {
	await socketHandler.sendLeaveMessage();
	callback();
}

export async function listenPlayerLeft(callback) {
	await socketHandler.listenPlayerLeft();
	callback();
}
