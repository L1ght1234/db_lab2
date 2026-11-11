export type SportCode = 'football' | 'basketball' | 'tennis';

export interface MatchPeriodDoc {
  periodNumber: number;
  label: string;
  homeScore: number;
  awayScore: number;
  homeStats: Record<string, number>;
  awayStats: Record<string, number>;
}

export interface MatchLineupItemDoc {
  teamId: number;
  playerId: number;
  playerName: string;
  isStarter: boolean;
  shirtNumber: number;
  role: string;
  minutesPlayed: number;
  rating: number;
  stats: Record<string, number>;
}

export interface MatchEventDoc {
  periodNumber: number;
  minute: number;
  teamId: number;
  playerId: number;
  playerName: string;
  assistPlayerId: number | null;
  assistPlayerName: string | null;
  type: string;
  description: string;
  metric?: { name: string; value: number };
}

export interface MatchProtocolDoc {
  matchId: number;
  sportCode: SportCode;
  sportName: string;
  tournament: {
    id: number;
    name: string;
    season: string;
  };
  venue: {
    id: number;
    name: string;
    city: string;
    capacity: number;
  };
  stageName: string;
  scheduledAt: Date;
  status: string;
  attendance: number;
  homeTeam: { id: number; name: string; city: string };
  awayTeam: { id: number; name: string; city: string };
  result: {
    homeScore: number;
    awayScore: number;
    winnerTeamId: number | null;
    isExtraTime: boolean;
    isPenalties: boolean;
  };
  periods: MatchPeriodDoc[];
  lineups: MatchLineupItemDoc[];
  events: MatchEventDoc[];
}
