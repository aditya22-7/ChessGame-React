import Stack from "./Stack";
import { useEffect, useState } from "react";
import { Alert, Button, Typography, Paper } from "@mui/material";
import { remaining } from "../features/tournaments/model";
export function ErrorNotice({ error, retry }) {
  return error ? (
    <Alert
      severity="error"
      action={
        retry ? (
          <Button color="inherit" onClick={retry}>
            Retry
          </Button>
        ) : null
      }
    >
      {error.message || String(error)}
    </Alert>
  ) : null;
}
export function Panel({ children, ...props }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, height: "100%" }}
      {...props}
    >
      {children}
    </Paper>
  );
}
export function Empty({ children }) {
  return (
    <Typography color="text.secondary" sx={{ py: 3 }}>
      {children}
    </Typography>
  );
}
export function Countdown({ deadline, serverNow, prefix = "" }) {
  const [anchor, setAnchor] = useState(() => ({
    serverNow: serverNow ?? Date.now(),
    monotonic: performance.now(),
  }));
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (serverNow != null)
      setAnchor({ serverNow, monotonic: performance.now() });
  }, [serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  if (deadline == null) return null;
  const seconds = Math.ceil(remaining(deadline, anchor, now) / 1000),
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return (
    <Typography
      component="span"
      sx={{ fontVariantNumeric: "tabular-nums", color: "primary.main" }}
    >
      {prefix}
      {hours ? `${hours}h ` : ""}
      {minutes}m {seconds % 60}s
    </Typography>
  );
}
export function Heading({ title, subtitle, action }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      gap={2}
      sx={{ mb: 3 }}
    >
      <div>
        <Typography variant="h1">{title}</Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </div>
      {action}
    </Stack>
  );
}
