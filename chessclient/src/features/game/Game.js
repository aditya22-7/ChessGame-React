import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardSet from "./BoardSet";
import { MemoButton } from "../../components/Button";
import { useLogin } from "../auth/LoginProvider";
import MiddelFlexBox from "../../components/MiddleFlexBox";
import Status from "./Status";
import { leaveGame } from "../../services/Controller";
import LoaderText from "../../components/LoaderText";

export default function Game() {
	const nav = useNavigate();
	const [status, setStatus] = useState("");
	const [loader, setLoader] = useState(false);
	const { setPlayer2, changeGameFlag } = useLogin();
	const leavingRef = useRef(false);

	const leaveCurrentGame = (navigateToLobby) => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		setStatus("Leaving Game..");
		setLoader(true);
		changeGameFlag();
		leaveGame(() => {
			setPlayer2("");
			if (navigateToLobby) nav(`/newgame`, { replace: true });
		});
	};

	useEffect(() => {
		const handleBrowserBack = () => leaveCurrentGame(false);
		window.addEventListener("popstate", handleBrowserBack);
		return () => window.removeEventListener("popstate", handleBrowserBack);
	}, []);

	if (loader) return <LoaderText text={status} />;

	return (
		<>
			<BoardSet />
			<Status />
			<MiddelFlexBox>
				<MemoButton onSubmit={() => leaveCurrentGame(true)}>Leave</MemoButton>
			</MiddelFlexBox>
		</>
	);
}
