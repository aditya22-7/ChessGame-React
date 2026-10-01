import { useData } from "./GameProvider";
import { useLogin } from "../auth/LoginProvider";
import MiddelFlexBox from "../../components/MiddleFlexBox";
import { MemoDisplayName } from "../../components/DisplayName";

export default function Status() {
	const { status } = useData();
	const { player2 } = useLogin();
	let text;
	switch (status) {
		case "Waiting for other player":
			text = `Waiting for ${player2} to make a move..`;
			break;
		default:
			text = status;
	}
	return (
		<MiddelFlexBox>
			<MemoDisplayName>{text}</MemoDisplayName>
		</MiddelFlexBox>
	);
}
