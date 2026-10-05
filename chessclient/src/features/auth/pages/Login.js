// import React, { useEffect, useReducer } from "react";
// import TextField from "@mui/material/TextField";
// import { Grid, Typography } from "@mui/material";
// import { useState } from "react";
// import { Navigate } from "react-router-dom";
// import LogicButton from "../../../components/Button";
// import { checkLogin } from "../../../services/Controller.js";
// import { useRef } from "react";

// export default function Login({ tries }) {
// 	const [username, setUsername] = useState("");
// 	const [password, setPassword] = useState("");
// 	const [count, setCount] = useState(tries);
// 	const promise = useRef();
// 	const btnClicked = useRef();

// 	const valsEmpty = () => username === "" && password === "";

// 	const get = (username, password, count) => {
// 		if (!promise.current)
// 			promise.current = checkLogin(username, password, count);
// 		return promise.current.read();
// 	};

// 	if (count > 0 && btnClicked.current) {
// 		const ret = get(username, password, count);
// 		if (ret.status === "failed")
// 			return <Navigate to="/failed" replace={true} />;
// 		if (ret.status === "success")
// 			return <Navigate to="/newgame" replace={true} />;
// 		btnClicked.current = false;
// 		if (ret.status === "restart") return <Navigate to="/" />;
// 	}

// 	const setUsernameHelper = (e) => {
// 		setUsername(e.target.value);
// 	};
// 	const setPasswordHelper = (e) => {
// 		setPassword(e.target.value);
// 	};

// 	const onSubmit = () => {
// 		if (valsEmpty()) return;
// 		promise.current = null;
// 		btnClicked.current = true;
// 		setCount((prev) => prev + 1);
// 	};

// 	return (
// 		<Grid
// 			container
// 			direction="column"
// 			justifyContent="center"
// 			alignItems="center"
// 			sx={{
// 				width: "100vw",
// 				height: "100vh",
// 			}}>
// 			<Grid justifyContent="center" display="flex">
// 				<Typography variant="h5" sx={{ m: 2 }}>
// 					Login
// 				</Typography>
// 			</Grid>

// 			{count > 0 && (
// 				<Grid justifyContent="center" display="flex">
// 					<Typography variant="h7" sx={{ m: 2 }}>
// 						Wrong usename or password, You have only {3 - count} tries left,
// 						Please try again!
// 					</Typography>
// 				</Grid>
// 			)}

// 			<Grid justifyContent="center" display="flex">
// 				<TextField
// 					id="outlined-basic"
// 					label="Username"
// 					variant="outlined"
// 					defaultValue=""
// 					onChange={setUsernameHelper}
// 					sx={{ m: 2 }}
// 				/>
// 			</Grid>

// 			<Grid justifyContent="center" display="flex">
// 				<TextField
// 					id="outlined-password-input"
// 					label="Password"
// 					type="password"
// 					defaultValue=""
// 					variant="outlined"
// 					onChange={setPasswordHelper}
// 					sx={{ m: 2 }}
// 				/>
// 			</Grid>

// 			<Grid justifyContent="center" display="flex">
// 				<LogicButton onSubmit={onSubmit}>Submit</LogicButton>
// 			</Grid>
// 		</Grid>
// 	);
// }

import React from "react";
import {
	Box,
	Button,
	Checkbox,
	FormControlLabel,
	Link,
	TextField,
	Typography,
} from "@mui/material";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { checkLogin } from "../../../services/Controller.js";
import { useRef } from "react";

// Midnight Atelier palette
const NAVY = "#101820";
const IVORY = "#F4F0E6";
const GOLD = "#C7A45A";
const GOLD_TEXT = "#8A6F2F"; // darker gold so links stay readable on ivory
const MUTED = "rgba(16, 24, 32, 0.65)";

const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';
const SANS = '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const labelSx = {
	display: "block",
	mb: 0.75,
	fontFamily: SANS,
	fontSize: "0.8rem",
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: MUTED,
};

const fieldSx = {
	"& .MuiOutlinedInput-root": {
		fontFamily: SANS,
		color: NAVY,
		backgroundColor: "#FBFAF5",
		borderRadius: "8px",
		"& fieldset": { borderColor: "rgba(16, 24, 32, 0.18)" },
		"&:hover fieldset": { borderColor: "rgba(16, 24, 32, 0.35)" },
		"&.Mui-focused fieldset": { borderColor: GOLD, borderWidth: 2 },
	},
	"& input::placeholder": { color: "rgba(16, 24, 32, 0.45)", opacity: 1 },
};

const linkSx = {
	fontFamily: SANS,
	fontSize: "0.85rem",
	color: GOLD_TEXT,
	textDecorationColor: "rgba(138, 111, 47, 0.5)",
	"&:hover": { color: NAVY },
};

export default function Login({ tries }) {
	const navigate = useNavigate();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [remember, setRemember] = useState(false);
	const [count, setCount] = useState(tries);
	const promise = useRef();
	const btnClicked = useRef();

	const valsEmpty = () => username === "" && password === "";

	const get = (username, password, count) => {
		if (!promise.current)
			promise.current = checkLogin(username, password, count);
		return promise.current.read();
	};

	if (count > 0 && btnClicked.current) {
		const ret = get(username, password, count);
		if (ret.status === "failed")
			return <Navigate to="/failed" replace={true} />;
		if (ret.status === "success")
			return <Navigate to="/newgame" replace={true} />;
		btnClicked.current = false;
		if (ret.status === "restart") return <Navigate to="/" />;
	}

	const setUsernameHelper = (e) => {
		setUsername(e.target.value);
	};
	const setPasswordHelper = (e) => {
		setPassword(e.target.value);
	};

	const onSubmit = () => {
		if (valsEmpty()) return;
		promise.current = null;
		btnClicked.current = true;
		setCount((prev) => prev + 1);
	};

	return (
		<Box
			sx={{
				minHeight: "100vh",
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				position: "relative",
				px: 2,
				py: 4,
			}}>
			<Button
				type="button"
				onClick={() => navigate("/")}
				startIcon={<span aria-hidden="true">←</span>}
				sx={{
					position: "absolute",
					top: { xs: 2, sm: 3 },
					left: { xs: 2, sm: 5 },
					color: IVORY,
					fontFamily: SANS,
					fontSize: "0.95rem",
					textTransform: "none",
					"&:hover": {
						backgroundColor: "transparent",
						color: GOLD,
					},
					"&.Mui-focusVisible": {
						outline: `2px solid ${GOLD}`,
						outlineOffset: 3,
					},
				}}
			>
				Welcome
			</Button>

				<Box
					component="form"
					noValidate
					onSubmit={(e) => {
						e.preventDefault(); // lets the Enter key submit too
						onSubmit();
					}}
					sx={{
						width: "100%",
						maxWidth: 420,
						px: { xs: 3, sm: 5 },
						py: { xs: 4, sm: 5 },
						borderRadius: "16px",
						backgroundColor: IVORY,
						boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
					}}>
					{/* Header */}
					<Box sx={{ textAlign: "center", mb: 3.5 }}>
						<Typography
							aria-hidden="true"
							sx={{ fontSize: "3rem", lineHeight: 1, color: GOLD }}>
							♞
						</Typography>
						<Typography
							component="h1"
							sx={{
								mt: 1,
								fontFamily: SERIF,
								fontWeight: 500,
								fontSize: { xs: "2rem", sm: "2.4rem" },
								color: NAVY,
							}}>
							Welcome back
						</Typography>
						<Typography
							sx={{ mt: 0.5, fontFamily: SANS, fontSize: "0.95rem", color: MUTED }}>
							Your next game is waiting.
						</Typography>
					</Box>

					{/* Wrong credentials message */}
					{count > 0 && (
						<Typography
							role="alert"
							sx={{
								mb: 2.5,
								px: 1.75,
								py: 1.25,
								borderRadius: "8px",
								fontFamily: SANS,
								fontSize: "0.9rem",
								color: "#7A2E2E",
								backgroundColor: "rgba(160, 60, 60, 0.1)",
								border: "1px solid rgba(160, 60, 60, 0.3)",
							}}>
							Wrong username or password. You have only {3 - count} tries left,
							please try again!
						</Typography>
					)}

					{/* Username */}
					<Box sx={{ mb: 2.5 }}>
						<Typography component="label" htmlFor="username" sx={labelSx}>
							Username
						</Typography>
						<TextField
							id="username"
							fullWidth
							placeholder="Enter your username"
							autoComplete="username"
							onChange={setUsernameHelper}
							sx={fieldSx}
						/>
					</Box>

					{/* Password */}
					<Box sx={{ mb: 1.5 }}>
						<Typography component="label" htmlFor="password" sx={labelSx}>
							Password
						</Typography>
						<TextField
							id="password"
							type="password"
							fullWidth
							placeholder="Enter your password"
							autoComplete="current-password"
							onChange={setPasswordHelper}
							sx={fieldSx}
						/>
					</Box>

					{/* Remember me / Forgot password (UI only for now) */}
					<Box
						sx={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							mb: 3,
						}}>
						<FormControlLabel
							control={
								<Checkbox
									size="small"
									checked={remember}
									onChange={(e) => setRemember(e.target.checked)}
									sx={{ color: MUTED, "&.Mui-checked": { color: GOLD_TEXT } }}
								/>
							}
							label="Remember me"
							sx={{
								m: 0,
								"& .MuiFormControlLabel-label": {
									fontFamily: SANS,
									fontSize: "0.85rem",
									color: MUTED,
								},
							}}
						/>
						{/* TODO: wire up when a reset-password route exists */}
						<Link component="button" type="button" underline="hover" sx={linkSx}>
							Forgot password?
						</Link>
					</Box>

					{/* Submit */}
					<Button
						type="submit"
						fullWidth
						disableElevation
						variant="contained"
						sx={{
							py: 1.5,
							fontFamily: SANS,
							fontSize: "1rem",
							fontWeight: 600,
							textTransform: "none",
							borderRadius: "8px",
							color: IVORY,
							backgroundColor: NAVY,
							"&:hover": { backgroundColor: "#1B2630" },
							"&.Mui-focusVisible": {
								outline: `2px solid ${GOLD}`,
								outlineOffset: 3,
							},
						}}>
						Sign in
					</Button>

					{/* Footer */}
					<Typography
						sx={{
							mt: 3,
							textAlign: "center",
							fontFamily: SANS,
							fontSize: "0.85rem",
							color: MUTED,
						}}>
						New to Chess Olympics?{" "}
						{/* TODO: wire up when a sign-up route exists */}
						<Link
							component="button"
							type="button"
							underline="hover"
							sx={{ ...linkSx, fontWeight: 600, verticalAlign: "baseline" }}>
							Create account
						</Link>
					</Typography>
				</Box>
			</Box>
	);
}