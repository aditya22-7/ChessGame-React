const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const mysql = require("../../node_modules/mysql2/promise");
const { createSqlServer } = require("../../server/sql/app");
const { migrate } = require("../../database/tools/migrate");
const { connectionOptions } = require("../../database/tools/connection");
let backend,
  frontend,
  now = Date.now(),
  players;
test.beforeAll(async () => {
  if (
    process.env.MYSQL_DATABASE !== "chess_ui_test" ||
    !process.env.MYSQL_PORT ||
    !process.env.MYSQL_USER
  )
    throw new Error(
      "Browser tests require explicit MYSQL_DATABASE=chess_ui_test, MYSQL_PORT and MYSQL_USER for a disposable MySQL 8.4 instance.",
    );
  const config = connectionOptions(),
    { database, ...adminConfig } = config,
    c = await mysql.createConnection(adminConfig);
  try {
    await c.query(
      "CREATE DATABASE IF NOT EXISTS chess_ui_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci",
    );
    await c.query("USE chess_ui_test");
    await migrate(c);
  } finally {
    await c.end();
  }
  backend = await createSqlServer({
    sessionSecret: "browser-test-secret-at-least-thirty-two-characters",
    clock: () => now,
    worker: false,
  });
  await new Promise((resolve, reject) =>
    backend.server.once("error", reject).listen(8081, "localhost", resolve),
  );
  const express = require("../../node_modules/express"),
    app = express();
  app.use(express.static(path.resolve(__dirname, "../build")));
  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname, "../build/index.html")),
  );
  frontend = await new Promise((resolve, reject) => {
    const s = app.listen(3000, "localhost", () => resolve(s));
    s.once("error", reject);
  });
  players = await Promise.all(
    [0, 1].map((i) =>
      backend.accounts.create(
        "browser_" + i + "_" + randomUUID().slice(0, 8),
        "BrowserTest123!",
      ),
    ),
  );
});
test.afterAll(async () => {
  if (backend) await backend.close();
  if (frontend) await new Promise((resolve) => frontend.close(resolve));
});
async function login(page, player) {
  await page.goto("/login");
  await page.getByPlaceholder("Enter your username").fill(player.username);
  await page.getByPlaceholder("Enter your password").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `Welcome, ${player.username}` }),
  ).toBeVisible();
}
async function tournament() {
  return backend.tournaments.create({
    name: "Browser Swiss " + randomUUID().slice(0, 8),
    registrationClosesAt: now + 60000,
    firstRoundStartsAt: now + 120000,
    totalRounds: 1,
    matchDurationMs: 120000,
    interRoundGapMs: 1000,
    reconnectGraceMs: 30000,
  });
}
test("two browsers register, join, navigate, play, refresh/rejoin, resign and see SQL standings", async ({
  browser,
}) => {
  const originalCommand = backend.tournaments.command;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p, i) => login(p, players[i])));
    const tour = await tournament();
    for (const page of pages) {
      await page.goto("/tournaments/" + tour.id);
      await page
        .getByRole("button", { name: "Register for tournament" })
        .click();
      await expect(
        page.getByRole("button", { name: "Withdraw permanently" }),
      ).toBeVisible();
    }
    now += 60000;
    await backend.run();
    for (const page of pages) {
      await page
        .getByRole("link", { name: "Open Round 1 waiting room" })
        .click();
      await page
        .getByRole("button", { name: "Join waiting room / reconnect" })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Attendance confirmed",
      );
    }
    await pages[0].getByRole("link", { name: "Rounds", exact: true }).click();
    await expect(
      pages[0].getByRole("heading", { name: "Round schedule" }),
    ).toBeVisible();
    await pages[0].getByRole("link", { name: "Return to match" }).click();
    await expect(pages[0].getByRole("status")).toContainText(
      "Attendance confirmed",
    );
    const raw = await backend.db.uow.run(
        (tx) => backend.tournaments.repo.load(tx.c, tour.id),
        { readOnly: true },
      ),
      match = raw.rounds[0].matches[0],
      whiteId = raw.entrants.find(
        (e) => e.id === match.whiteEntrantId,
      ).playerId,
      white = pages[players.findIndex((p) => p.id === whiteId)],
      black = pages.find((p) => p !== white);
    now += 60000;
    await backend.run();
    await expect(white.getByRole("status")).toHaveText("Your turn");
    await white.screenshot({
      path: path.resolve(__dirname, "../test-results/tournament-board.png"),
      fullPage: true,
    });
    let uncertain = true;
    backend.tournaments.command = async function (...args) {
      const value = await originalCommand.apply(this, args);
      if (uncertain && args[2] === whiteId && args[3].type === "MOVE") {
        uncertain = false;
        throw new (require("../../server/tournaments/errors").DomainError)(
          "COMMIT_OUTCOME_UNKNOWN",
          "Simulated lost commit response",
          503,
        );
      }
      return value;
    };
    await white
      .getByRole("button", { name: "e2, white pawn", exact: true })
      .click();
    await white.getByRole("button", { name: "e4, empty", exact: true }).click();
    await expect(black.getByRole("status")).toHaveText("Your turn");
    await black
      .getByRole("button", { name: "e7, black pawn", exact: true })
      .click();
    await black.getByRole("button", { name: "e5, empty", exact: true }).click();
    await expect(white.getByRole("status")).toHaveText("Your turn");
    await white
      .getByRole("button", { name: "Resolve action", exact: true })
      .click();
    await expect(
      white.getByRole("button", { name: "Resolve action", exact: true }),
    ).toHaveCount(0);
    await expect(
      white.getByRole("button", { name: "e5, black pawn", exact: true }),
    ).toBeVisible();
    await white.reload();
    await expect(white.getByRole("status")).toHaveText("Your turn");
    await expect(
      white.getByRole("button", { name: "e4, white pawn", exact: true }),
    ).toBeVisible();
    const oldSocket = [...backend.io.sockets.sockets.values()].find(
      (s) => s.request.session?.playerId === whiteId,
    );
    const previousSocketId = oldSocket.id;
    oldSocket.conn.close();
    await expect
      .poll(() =>
        [...backend.io.sockets.sockets.values()].some(
          (s) =>
            s.id !== previousSocketId &&
            s.request.session?.playerId === whiteId,
        ),
      )
      .toBe(true);
    await expect(white.getByRole("status")).toHaveText("Your turn");
    await black.getByRole("button", { name: "Resign", exact: true }).click();
    await black.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      white.getByRole("heading", { name: "Match result", exact: true }),
    ).toBeVisible();
    await expect(white.getByText(/You won · Resignation/)).toBeVisible();
    await white.getByRole("link", { name: "Standings", exact: true }).click();
    await expect(
      white.getByRole("cell", {
        name: players.find((p) => p.id === whiteId).username,
        exact: true,
      }),
    ).toBeVisible();
    const rows = await backend.db.uow.run(
      async (tx) =>
        (await tx.c.query("SELECT * FROM v_schema_integrity_issues"))[0],
      { readOnly: true },
    );
    expect(rows).toEqual([]);
    await white.screenshot({
      path: path.resolve(__dirname, "../test-results/standings-desktop.png"),
      fullPage: true,
    });
  } finally {
    backend.tournaments.command = originalCommand;
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("hard deadline is confirmed as a draw and logout revokes the browser session", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p, i) => login(p, players[i])));
    const tour = await tournament();
    for (const p of players) await backend.tournaments.register(tour.id, p.id);
    now += 60000;
    await backend.run();
    const match = (await backend.tournaments.get(tour.id)).rounds[0].matches[0];
    for (const page of pages) {
      await page.goto(`/tournaments/${tour.id}/matches/${match.id}`);
      await page
        .getByRole("button", { name: "Join waiting room / reconnect" })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Attendance confirmed",
      );
    }
    now += 60000;
    await backend.run();
    await expect(
      pages[0].getByRole("heading", { name: "Your tournament game" }),
    ).toBeVisible();
    now += 120000;
    await backend.run();
    await expect(pages[0].getByText(/Draw · Match deadline/)).toBeVisible();
    await pages[0]
      .getByRole("button", { name: "Close match participation" })
      .click();
    await pages[0].getByRole("button", { name: "Logout", exact: true }).click();
    await expect(pages[0]).toHaveURL(/\/login$/);
    expect(
      (await contexts[0].request.get("http://localhost:8081/session")).status(),
    ).toBe(401);
    await pages[0].goto("/tournaments");
    await expect(pages[0]).toHaveURL(/\/login$/);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("withdrawal is permanent and mobile tournament layout fits the viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  try {
    await login(page, players[0]);
    const tour = await tournament();
    await page.goto("/tournaments/" + tour.id);
    await page.getByRole("button", { name: "Register for tournament" }).click();
    await page
      .getByRole("button", { name: "Withdraw permanently", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Withdrawal is permanent");
    await dialog.getByRole("button", { name: "Withdraw permanently" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Register for tournament" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    expect(
      await navigation.evaluate((el) =>
        [...el.children].every((child) => {
          const r = child.getBoundingClientRect();
          return r.left >= 0 && r.right <= window.innerWidth;
        }),
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(__dirname, "../test-results/tournament-mobile.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test("quick play uses the shared board and exchanges committed moves", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p, i) => login(p, players[i])));
    for (const page of pages) {
      await page.goto("/play");
      await page
        .getByRole("button", { name: "Find a game", exact: true })
        .click();
    }
    await expect(
      pages[0].getByRole("group", { name: /Chess board/ }),
    ).toBeVisible();
    await expect(
      pages[1].getByRole("group", { name: /Chess board/ }),
    ).toBeVisible();
    const white =
        (await pages[0].getByRole("status").textContent()) === "Your turn"
          ? pages[0]
          : pages[1],
      black = pages.find((p) => p !== white);
    await white
      .getByRole("button", { name: "e2, white pawn", exact: true })
      .click();
    await white.getByRole("button", { name: "e4, empty", exact: true }).click();
    await expect(black.getByRole("status")).toHaveText("Your turn");
    await expect(
      black.getByRole("button", { name: "e4, white pawn", exact: true }),
    ).toBeVisible();
    await white
      .getByRole("button", { name: "Leave game (forfeit)", exact: true })
      .click();
    await expect(black.getByRole("status")).toContainText("Opponent left");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
