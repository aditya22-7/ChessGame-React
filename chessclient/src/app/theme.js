import { createTheme } from "@mui/material/styles";
export const colors = {
  navy: "#101820",
  ivory: "#F4F0E6",
  gold: "#C7A45A",
  green: "#8FB3A6",
  border: "rgba(244,240,230,.12)",
};
export default createTheme({
  palette: {
    mode: "dark",
    primary: { main: colors.gold },
    secondary: { main: colors.green },
    background: { default: colors.navy, paper: "#172027" },
    text: { primary: colors.ivory, secondary: "#B5B8B4" },
  },
  typography: {
    allVariants: { overflowWrap: "anywhere" },
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    h1: { fontFamily: "Georgia, serif", fontSize: "2.5rem" },
    h2: { fontFamily: "Georgia, serif", fontSize: "1.8rem" },
    h3: { fontFamily: "Georgia, serif", fontSize: "1.3rem" },
    button: { textTransform: "none" },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none", border: `1px solid ${colors.border}` },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: { styleOverrides: { root: { borderColor: colors.border } } },
  },
});
