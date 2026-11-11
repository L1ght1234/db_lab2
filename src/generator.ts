import type {
  MatchEventDoc,
  MatchLineupItemDoc,
  MatchPeriodDoc,
  MatchProtocolDoc,
  SportCode,
} from './models.js';

export interface SportRef {
  id: number;
  code: SportCode;
  name: string;
}

export interface VenueRef {
  id: number;
  name: string;
  city: string;
  capacity: number;
}

export interface TournamentRef {
  id: number;
  sportId: number;
  name: string;
  season: string;
}

export interface TeamRef {
  id: number;
  sportId: number;
  name: string;
  city: string;
}

export interface PlayerRef {
  id: number;
  teamId: number;
  fullName: string;
  birthYear: number;
  defaultPosition: string;
}

export interface ReferenceDataset {
  sports: SportRef[];
  venues: VenueRef[];
  tournaments: TournamentRef[];
  teams: TeamRef[];
  players: PlayerRef[];
  teamsBySport: Map<number, TeamRef[]>;
  playersByTeam: Map<number, PlayerRef[]>;
  tournamentsBySport: Map<number, TournamentRef[]>;
}

export function createRng(seed = 20261111): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(rng: () => number, min: number, max: number): number {
  return Number((rng() * (max - min) + min).toFixed(2));
}

const CITIES = [
  'Київ',
  'Львів',
  'Дніпро',
  'Харків',
  'Одеса',
  'Запоріжжя',
  'Полтава',
  'Житомир',
  'Вінниця',
  'Рівне',
];

const FIRST_NAMES = [
  'Олександр',
  'Андрій',
  'Максим',
  'Дмитро',
  'Артем',
  'Іван',
  'Сергій',
  'Богдан',
  'Тарас',
  'Владислав',
  'Євген',
  'Назар',
  'Денис',
  'Микита',
  'Олег',
];

const LAST_NAMES = [
  'Коваленко',
  'Шевченко',
  'Мельник',
  'Бондаренко',
  'Ткаченко',
  'Бойко',
  'Кравченко',
  'Олійник',
  'Савченко',
  'Лисенко',
  'Поліщук',
  'Руденко',
  'Мороз',
  'Павленко',
  'Савчук',
];

const TEAM_PREFIXES: Record<SportCode, string[]> = {
  football: ['ФК', 'СК', 'АФК'],
  basketball: ['БК', 'Баскет-Клуб', 'Академія'],
  tennis: ['ТК', 'Корт', 'Про-Теніс'],
};

const POSITIONS_BY_SPORT: Record<SportCode, string[]> = {
  football: ['Воротар', 'Захисник', 'Півзахисник', 'Нападник'],
  basketball: ['Розігруючий', 'Атакуючий', 'Форвард', 'Центровий'],
  tennis: ['Одиночний розряд'],
};

const SEASONS = ['2022/2023', '2023/2024', '2024/2025', '2025/2026', '2026/2027'];
const STAGES = ['Груповий етап', 'Тур 1', 'Тур 2', '1/8 фіналу', 'Чвертьфінал', 'Півфінал', 'Фінал'];

export function buildReferenceData(): ReferenceDataset {
  const rng = createRng(42);

  const sports: SportRef[] = [
    { id: 1, code: 'football', name: 'Футбол' },
    { id: 2, code: 'basketball', name: 'Баскетбол' },
    { id: 3, code: 'tennis', name: 'Теніс' },
  ];

  const venues: VenueRef[] = Array.from({ length: 30 }, (_, i) => {
    const city = CITIES[i % CITIES.length];
    return {
      id: i + 1,
      name: `Арена ${city} #${Math.floor(i / CITIES.length) + 1}`,
      city,
      capacity: 3000 + (i % 10) * 5500,
    };
  });

  const tournaments: TournamentRef[] = [];
  let tId = 1;
  for (const s of sports) {
    for (const season of SEASONS) {
      tournaments.push({
        id: tId++,
        sportId: s.id,
        name: `Кубок України (${s.name})`,
        season,
      });
    }
  }

  const teams: TeamRef[] = [];
  let teamId = 1;
  for (const s of sports) {
    const prefixes = TEAM_PREFIXES[s.code];
    for (let i = 0; i < 30; i++) {
      const city = CITIES[i % CITIES.length];
      const prefix = prefixes[i % prefixes.length];
      teams.push({
        id: teamId++,
        sportId: s.id,
        name: `${prefix} ${city} ${Math.floor(i / CITIES.length) + 1}`,
        city,
      });
    }
  }

  const players: PlayerRef[] = [];
  let playerId = 1;
  const sportById = new Map(sports.map((s) => [s.id, s]));

  for (const team of teams) {
    const sport = sportById.get(team.sportId)!;
    const positions = POSITIONS_BY_SPORT[sport.code];
    for (let j = 0; j < 20; j++) {
      const fn = FIRST_NAMES[(team.id + j) % FIRST_NAMES.length];
      const ln = LAST_NAMES[(team.id * 3 + j) % LAST_NAMES.length];
      players.push({
        id: playerId++,
        teamId: team.id,
        fullName: `${fn} ${ln}`,
        birthYear: randInt(rng, 1991, 2005),
        defaultPosition: positions[j % positions.length],
      });
    }
  }

  const teamsBySport = new Map<number, TeamRef[]>();
  for (const t of teams) {
    const list = teamsBySport.get(t.sportId) ?? [];
    list.push(t);
    teamsBySport.set(t.sportId, list);
  }

  const playersByTeam = new Map<number, PlayerRef[]>();
  for (const p of players) {
    const list = playersByTeam.get(p.teamId) ?? [];
    list.push(p);
    playersByTeam.set(p.teamId, list);
  }

  const tournamentsBySport = new Map<number, TournamentRef[]>();
  for (const tr of tournaments) {
    const list = tournamentsBySport.get(tr.sportId) ?? [];
    list.push(tr);
    tournamentsBySport.set(tr.sportId, list);
  }

  return {
    sports,
    venues,
    tournaments,
    teams,
    players,
    teamsBySport,
    playersByTeam,
    tournamentsBySport,
  };
}

export function generateMatchProtocol(
  matchId: number,
  refs: ReferenceDataset,
  rng: () => number
): { sportId: number; doc: MatchProtocolDoc } {
  const roll = matchId % 10;
  const sport =
    roll < 5 ? refs.sports[0] : roll < 8 ? refs.sports[1] : refs.sports[2];

  const sportTeams = refs.teamsBySport.get(sport.id)!;
  const homeIdx = randInt(rng, 0, sportTeams.length - 1);
  let awayIdx = randInt(rng, 0, sportTeams.length - 2);
  if (awayIdx >= homeIdx) awayIdx += 1;

  const homeTeam = sportTeams[homeIdx];
  const awayTeam = sportTeams[awayIdx];
  const venue = refs.venues[randInt(rng, 0, refs.venues.length - 1)];
  const sportTours = refs.tournamentsBySport.get(sport.id)!;
  const tournament = sportTours[randInt(rng, 0, sportTours.length - 1)];
  const stageName = STAGES[randInt(rng, 0, STAGES.length - 1)];

  const baseTime = Date.UTC(2023, 0, 1) + matchId * 3600 * 1000;
  const scheduledAt = new Date(baseTime);
  const attendance = randInt(rng, Math.floor(venue.capacity * 0.25), venue.capacity);

  const periods: MatchPeriodDoc[] = [];
  const lineups: MatchLineupItemDoc[] = [];
  const events: MatchEventDoc[] = [];

  const homeRoster = refs.playersByTeam.get(homeTeam.id)!;
  const awayRoster = refs.playersByTeam.get(awayTeam.id)!;

  let totalHome = 0;
  let totalAway = 0;

  if (sport.code === 'football') {
    for (let p = 1; p <= 2; p++) {
      const hs = randInt(rng, 0, 3);
      const as = randInt(rng, 0, 3);
      totalHome += hs;
      totalAway += as;
      const homePoss = randInt(rng, 35, 65);
      periods.push({
        periodNumber: p,
        label: `${p}-й тайм`,
        homeScore: hs,
        awayScore: as,
        homeStats: {
          possession_pct: homePoss,
          shots_on_target: randInt(rng, hs, hs + 6),
          xg: randFloat(rng, hs * 0.4, hs * 1.1 + 0.8),
        },
        awayStats: {
          possession_pct: 100 - homePoss,
          shots_on_target: randInt(rng, as, as + 6),
          xg: randFloat(rng, as * 0.4, as * 1.1 + 0.8),
        },
      });
    }

    for (const [team, roster] of [
      [homeTeam, homeRoster],
      [awayTeam, awayRoster],
    ] as const) {
      for (let i = 0; i < 12; i++) {
        const pl = roster[i];
        lineups.push({
          teamId: team.id,
          playerId: pl.id,
          playerName: pl.fullName,
          isStarter: i < 11,
          shirtNumber: i + 1,
          role: pl.defaultPosition,
          minutesPlayed: i < 11 ? randInt(rng, 65, 90) : randInt(rng, 10, 30),
          rating: randFloat(rng, 5.5, 9.4),
          stats: {
            goals: rng() > 0.82 ? 1 : 0,
            passes_completed: randInt(rng, 12, 75),
          },
        });
      }
    }

    for (let e = 0; e < 10; e++) {
      const isHome = e % 2 === 0;
      const roster = isHome ? homeRoster : awayRoster;
      const team = isHome ? homeTeam : awayTeam;
      const player = roster[randInt(rng, 0, 11)];
      const assist = rng() > 0.5 ? roster[randInt(rng, 0, 11)] : null;
      const evType =
        e < 3 ? 'goal' : e < 6 ? 'yellow_card' : e < 8 ? 'substitution' : 'foul';
      const periodNumber = e < 5 ? 1 : 2;
      events.push({
        periodNumber,
        minute: periodNumber === 1 ? randInt(rng, 1, 45) : randInt(rng, 46, 90),
        teamId: team.id,
        playerId: player.id,
        playerName: player.fullName,
        assistPlayerId: assist && assist.id !== player.id ? assist.id : null,
        assistPlayerName: assist && assist.id !== player.id ? assist.fullName : null,
        type: evType,
        description: `${evType} (${player.fullName})`,
        metric: evType === 'goal' ? { name: 'xg', value: randFloat(rng, 0.08, 0.85) } : undefined,
      });
    }
  } else if (sport.code === 'basketball') {
    for (let p = 1; p <= 4; p++) {
      const hs = randInt(rng, 16, 32);
      const as = randInt(rng, 16, 32);
      totalHome += hs;
      totalAway += as;
      periods.push({
        periodNumber: p,
        label: `${p}-та чверть`,
        homeScore: hs,
        awayScore: as,
        homeStats: {
          three_pointers: randInt(rng, 1, 6),
          rebounds: randInt(rng, 6, 15),
          turnovers: randInt(rng, 1, 6),
        },
        awayStats: {
          three_pointers: randInt(rng, 1, 6),
          rebounds: randInt(rng, 6, 15),
          turnovers: randInt(rng, 1, 6),
        },
      });
    }

    for (const [team, roster] of [
      [homeTeam, homeRoster],
      [awayTeam, awayRoster],
    ] as const) {
      for (let i = 0; i < 8; i++) {
        const pl = roster[i];
        lineups.push({
          teamId: team.id,
          playerId: pl.id,
          playerName: pl.fullName,
          isStarter: i < 5,
          shirtNumber: (i + 1) * 3,
          role: pl.defaultPosition,
          minutesPlayed: i < 5 ? randInt(rng, 22, 36) : randInt(rng, 8, 18),
          rating: randFloat(rng, 5.8, 9.5),
          stats: {
            points: randInt(rng, 2, 28),
            rebounds: randInt(rng, 1, 12),
          },
        });
      }
    }

    for (let e = 0; e < 14; e++) {
      const isHome = e % 2 === 0;
      const roster = isHome ? homeRoster : awayRoster;
      const team = isHome ? homeTeam : awayTeam;
      const player = roster[randInt(rng, 0, 7)];
      const periodNumber = (e % 4) + 1;
      const evType = e % 3 === 0 ? 'three_pointer' : e % 3 === 1 ? 'two_pointer' : 'foul';
      events.push({
        periodNumber,
        minute: (periodNumber - 1) * 10 + randInt(rng, 1, 10),
        teamId: team.id,
        playerId: player.id,
        playerName: player.fullName,
        assistPlayerId: null,
        assistPlayerName: null,
        type: evType,
        description: `${evType} (${player.fullName})`,
        metric: evType === 'three_pointer' ? { name: 'distance_m', value: randFloat(rng, 6.75, 8.9) } : undefined,
      });
    }
  } else {
    for (let p = 1; p <= 3; p++) {
      const homeWinsSet = rng() > 0.5;
      const hs = homeWinsSet ? 6 : randInt(rng, 2, 4);
      const as = homeWinsSet ? randInt(rng, 2, 4) : 6;
      if (hs > as) totalHome += 1;
      else totalAway += 1;
      periods.push({
        periodNumber: p,
        label: `${p}-й сет`,
        homeScore: hs,
        awayScore: as,
        homeStats: {
          aces: randInt(rng, 1, 8),
          double_faults: randInt(rng, 0, 4),
          winners: randInt(rng, 5, 16),
        },
        awayStats: {
          aces: randInt(rng, 1, 8),
          double_faults: randInt(rng, 0, 4),
          winners: randInt(rng, 5, 16),
        },
      });
    }

    for (const [team, roster] of [
      [homeTeam, homeRoster],
      [awayTeam, awayRoster],
    ] as const) {
      const pl = roster[0];
      lineups.push({
        teamId: team.id,
        playerId: pl.id,
        playerName: pl.fullName,
        isStarter: true,
        shirtNumber: 1,
        role: pl.defaultPosition,
        minutesPlayed: randInt(rng, 85, 165),
        rating: randFloat(rng, 6.0, 9.6),
        stats: {
          aces: randInt(rng, 3, 20),
          first_serve_pct: randInt(rng, 55, 78),
        },
      });
    }

    for (let e = 0; e < 8; e++) {
      const isHome = e % 2 === 0;
      const roster = isHome ? homeRoster : awayRoster;
      const team = isHome ? homeTeam : awayTeam;
      const player = roster[0];
      const periodNumber = (e % 3) + 1;
      const evType = e % 2 === 0 ? 'ace' : 'break_point';
      events.push({
        periodNumber,
        minute: periodNumber * 35 + randInt(rng, 1, 30),
        teamId: team.id,
        playerId: player.id,
        playerName: player.fullName,
        assistPlayerId: null,
        assistPlayerName: null,
        type: evType,
        description: `${evType} (${player.fullName})`,
        metric: evType === 'ace' ? { name: 'speed_kmh', value: randFloat(rng, 180, 224) } : undefined,
      });
    }
  }

  const winnerTeamId =
    totalHome > totalAway ? homeTeam.id : totalAway > totalHome ? awayTeam.id : null;

  return {
    sportId: sport.id,
    doc: {
      matchId,
      sportCode: sport.code,
      sportName: sport.name,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        season: tournament.season,
      },
      venue: {
        id: venue.id,
        name: venue.name,
        city: venue.city,
        capacity: venue.capacity,
      },
      stageName,
      scheduledAt,
      status: 'completed',
      attendance,
      homeTeam: { id: homeTeam.id, name: homeTeam.name, city: homeTeam.city },
      awayTeam: { id: awayTeam.id, name: awayTeam.name, city: awayTeam.city },
      result: {
        homeScore: totalHome,
        awayScore: totalAway,
        winnerTeamId,
        isExtraTime: false,
        isPenalties: false,
      },
      periods,
      lineups,
      events,
    },
  };
}
