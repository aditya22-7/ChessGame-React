import { useQuery } from "@tanstack/react-query";
import { request, tournamentPath } from "../../infrastructure/api";
export function useTournament(id) {
  return useQuery({
    queryKey: ["tournament", id],
    queryFn: ({ signal }) => request(tournamentPath(id), { signal }),
    refetchInterval: 15000,
  });
}
export function useMine(id) {
  return useQuery({
    queryKey: ["participation", id],
    queryFn: ({ signal }) =>
      request(tournamentPath(id) + "/my-status", { signal }),
    refetchInterval: 10000,
  });
}
export function useStandings(id) {
  return useQuery({
    queryKey: ["standings", id],
    queryFn: ({ signal }) =>
      request(tournamentPath(id) + "/standings", { signal }),
    refetchInterval: 15000,
  });
}
