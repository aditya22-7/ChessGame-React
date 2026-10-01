import * as React from "react";
import { Navigate } from "react-router-dom";
import { checkLoginStatus } from "../../../services/Controller";
import NewGame from "../../lobby/NewGame";

let promise = null;

const get = () => {
	if (promise === null) promise = checkLoginStatus();
	return promise.read();
};

export default function NewGameAuth() {
	const ret = get();
	promise = null;
	if (ret.status === "loggedIn") return <NewGame name={ret.name} />;
	if (ret.status === "failed") return <Navigate to="/failed" replace={true} />;
	if (ret.status === "login") return <Navigate to="/login" replace={true} />;
}
