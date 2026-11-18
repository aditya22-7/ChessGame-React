import React from "react";
import { Alert, Box, Button } from "@mui/material";
export default class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Box sx={{ p: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          }
        >
          This screen could not be displayed. Tournament deadlines continue on
          the server. Reload and reconnect promptly.
        </Alert>
      </Box>
    ) : (
      this.props.children
    );
  }
}
