import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginProvider from "../auth/LoginProvider";
import NewGame from "./NewGame";
import { fetchPlayerRating, fetchRatingHistory } from "../../services/Controller";

jest.mock("../../services/Controller", () => ({
  fetchPlayerRating: jest.fn(), fetchRatingHistory: jest.fn(),
  initSocket: jest.fn(), createNewGame: jest.fn(), disconnect: jest.fn(), logout: jest.fn(),
}));
const mount = () => render(<MemoryRouter><LoginProvider><NewGame name="jon" /></LoginProvider></MemoryRouter>);
beforeEach(() => jest.clearAllMocks());

test("shows persisted Elo and real draw history instead of sample ratings", async () => {
  fetchPlayerRating.mockResolvedValue({ rating: 1345, ratedGames: 3 });
  fetchRatingHistory.mockResolvedValue({ games: [{ gameId: "real-game", opponentId: "tom",
    side: "black", score: 0.5, delta: -8, tournamentName: "Swiss Event" }] });
  mount();
  expect(await screen.findByText("1,345")).toBeInTheDocument();
  expect(screen.getByText("Swiss Event")).toBeInTheDocument();
  expect(screen.getByText("tom")).toBeInTheDocument();
  expect(screen.getByText("Draw")).toBeInTheDocument();
  expect(screen.getByText("-8")).toBeInTheDocument();
  expect(screen.queryByText("1,842")).not.toBeInTheDocument();
});
test("reports unavailable rating data instead of inventing a rating", async () => {
  fetchPlayerRating.mockRejectedValue(new Error("offline"));
  fetchRatingHistory.mockResolvedValue({ games: [] });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Rating data is unavailable");
  expect(screen.queryByText("1,842")).not.toBeInTheDocument();
  expect(screen.queryByText("Autumn Masters")).not.toBeInTheDocument();
});
test("refreshes the rating on return to the window", async () => {
  fetchPlayerRating.mockResolvedValueOnce({ rating: 1200, ratedGames: 0 })
    .mockResolvedValueOnce({ rating: 1216, ratedGames: 1 });
  fetchRatingHistory.mockResolvedValue({ games: [] });
  mount();
  expect(await screen.findByText("1,200")).toBeInTheDocument();
  act(() => window.dispatchEvent(new Event("focus")));
  expect(await screen.findByText("1,216")).toBeInTheDocument();
});
