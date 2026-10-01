import * as React from "react";
import Login from "../pages/Login";
import { Navigate } from "react-router-dom";
import { checkLoginStatus } from "../../../services/Controller";
import { Suspense } from "react";
import LoaderText from "../../../components/LoaderText";

let promise = null;

const get = () => {
	if (promise === null) promise = checkLoginStatus();
	return promise.read();
};

export default function LoginAuth() {
	const ret = get();
	promise = null;
	if (ret.status === "loggedIn")
		return <Navigate to="/newgame" replace={true} />;
	if (ret.status === "failed") return <Navigate to="/failed" replace={true} />;
	if (ret.status === "login")
		return (
			<Suspense fallback={<LoaderText text="Logging In..." />}>
				<Login tries={ret.tries} />
			</Suspense>
		);
}
