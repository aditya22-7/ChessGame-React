import DataProvider from "../features/game/GameProvider";
import { Routes, Route } from "react-router-dom";
import Game from "../features/game/Game";
import Welcome from "../features/auth/pages/Welcome";
import LoginProvider from "../features/auth/LoginProvider";
import LoginAuth from "../features/auth/guards/LoginAuth";
import { BrowserRouter as Router } from "react-router-dom";
import LoaderText from "../components/LoaderText";
import GameAuth from "../features/auth/guards/GameAuth";
import FailureAuth from "../features/auth/guards/FailureAuth";
import { Suspense } from "react";
import NewGameAuth from "../features/auth/guards/NewGameAuth";

export default function App() {
	return (
		<LoginProvider>
			<Router>
				<Routes>
					<Route path="/" element={<Welcome />} />
					<Route
						path="/login"
						element={
							<Suspense fallback={<LoaderText text="Loading, Please Wait" />}>
								<LoginAuth />
							</Suspense>
						}
					/>
					<Route
						path="/failed"
						element={
							<Suspense fallback={<LoaderText text="Loading, Please Wait" />}>
								<FailureAuth />
							</Suspense>
						}
					/>
					<Route
						path="/newgame"
						element={
							<Suspense fallback={<LoaderText text="Loading, Please Wait" />}>
								<NewGameAuth />
							</Suspense>
						}
					/>
					<Route
						path="/game"
						element={
							<GameAuth>
								<DataProvider>
									<Game />
								</DataProvider>
							</GameAuth>
						}
					/>
				</Routes>
			</Router>
		</LoginProvider>
	);
}
