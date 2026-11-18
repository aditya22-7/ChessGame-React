import MuiStack from "@mui/material/Stack";
// Material UI 9 uses sx for system styles. Keep layout values explicit rather
// than forwarding obsolete system props to the DOM.
export default function Stack({
  gap,
  alignItems,
  justifyContent,
  flexWrap,
  sx,
  ...props
}) {
  return (
    <MuiStack
      spacing={gap}
      useFlexGap
      sx={{ alignItems, justifyContent, flexWrap, ...sx }}
      {...props}
    />
  );
}
