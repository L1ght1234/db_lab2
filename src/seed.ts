import fs from 'node:fs';
import path from 'node:path';
import { closeMongo, connectMongo, pgPool } from './db.js';
import { buildReferenceData, createRng, generateMatchProtocol } from './generator.js';
import type { MatchProtocolDoc } from './models.js';

const TOTAL_MATCHES = Number(process.env.MATCH_COUNT ?? 20_000);
const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const totalStart = performance.now();
  console.log(`=== Сидінг даних: ${TOTAL_MATCHES.toLocaleString('uk-UA')} матчів (PostgreSQL + MongoDB) ===`);

  const schemaSql = fs.readFileSync(path.resolve('sql', '01_schema.sql'), 'utf8');
  const indexesSql = fs.readFileSync(path.resolve('sql', '02_indexes.sql'), 'utf8');

  const { db: mongoDb } = await connectMongo();
  const protocolsCol = mongoDb.collection<MatchProtocolDoc>('match_protocols');

  await pgPool.query(schemaSql);
  await protocolsCol.drop().catch(() => {
  });

  const refs = buildReferenceData();

  await pgPool.query(
    `INSERT INTO sports (id, code, name)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[])`,
    [refs.sports.map((s) => s.id), refs.sports.map((s) => s.code), refs.sports.map((s) => s.name)]
  );

  await pgPool.query(
    `INSERT INTO venues (id, name, city, capacity)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[])`,
    [
      refs.venues.map((v) => v.id),
      refs.venues.map((v) => v.name),
      refs.venues.map((v) => v.city),
      refs.venues.map((v) => v.capacity),
    ]
  );

  await pgPool.query(
    `INSERT INTO tournaments (id, sport_id, name, season)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[])`,
    [
      refs.tournaments.map((t) => t.id),
      refs.tournaments.map((t) => t.sportId),
      refs.tournaments.map((t) => t.name),
      refs.tournaments.map((t) => t.season),
    ]
  );

  await pgPool.query(
    `INSERT INTO teams (id, sport_id, name, city)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[])`,
    [
      refs.teams.map((t) => t.id),
      refs.teams.map((t) => t.sportId),
      refs.teams.map((t) => t.name),
      refs.teams.map((t) => t.city),
    ]
  );

  await pgPool.query(
    `INSERT INTO players (id, team_id, full_name, birth_year, default_position)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::int[], $5::text[])`,
    [
      refs.players.map((p) => p.id),
      refs.players.map((p) => p.teamId),
      refs.players.map((p) => p.fullName),
      refs.players.map((p) => p.birthYear),
      refs.players.map((p) => p.defaultPosition),
    ]
  );

  const rng = createRng(20261111);
  let nextPeriodId = 1;
  let pgTimeMs = 0;
  let mongoTimeMs = 0;

  for (let startId = 1; startId <= TOTAL_MATCHES; startId += BATCH_SIZE) {
    const endId = Math.min(startId + BATCH_SIZE - 1, TOTAL_MATCHES);
    const docs: MatchProtocolDoc[] = [];

    const mId: number[] = [];
    const mTour: number[] = [];
    const mSport: number[] = [];
    const mVenue: number[] = [];
    const mHome: number[] = [];
    const mAway: number[] = [];
    const mStage: string[] = [];
    const mSched: Date[] = [];
    const mStatus: string[] = [];
    const mAttend: number[] = [];

    const rMatch: number[] = [];
    const rHome: number[] = [];
    const rAway: number[] = [];
    const rWinner: (number | null)[] = [];
    const rEt: boolean[] = [];
    const rPen: boolean[] = [];

    const pId: number[] = [];
    const pMatch: number[] = [];
    const pNum: number[] = [];
    const pLabel: string[] = [];
    const pHome: number[] = [];
    const pAway: number[] = [];

    const psPeriod: number[] = [];
    const psTeam: number[] = [];
    const psKey: string[] = [];
    const psVal: number[] = [];

    const lMatch: number[] = [];
    const lTeam: number[] = [];
    const lPlayer: number[] = [];
    const lStarter: boolean[] = [];
    const lShirt: number[] = [];
    const lRole: string[] = [];
    const lMin: number[] = [];
    const lRating: number[] = [];
    const lPName: string[] = [];
    const lPVal: number[] = [];
    const lSName: string[] = [];
    const lSVal: number[] = [];

    const eMatch: number[] = [];
    const eTeam: number[] = [];
    const ePlayer: number[] = [];
    const eAssist: (number | null)[] = [];
    const ePer: number[] = [];
    const eMin: number[] = [];
    const eType: string[] = [];
    const eDesc: string[] = [];
    const eMName: (string | null)[] = [];
    const eMVal: (number | null)[] = [];

    for (let id = startId; id <= endId; id++) {
      const { sportId, doc } = generateMatchProtocol(id, refs, rng);
      docs.push(doc);

      mId.push(doc.matchId);
      mTour.push(doc.tournament.id);
      mSport.push(sportId);
      mVenue.push(doc.venue.id);
      mHome.push(doc.homeTeam.id);
      mAway.push(doc.awayTeam.id);
      mStage.push(doc.stageName);
      mSched.push(doc.scheduledAt);
      mStatus.push(doc.status);
      mAttend.push(doc.attendance);

      rMatch.push(doc.matchId);
      rHome.push(doc.result.homeScore);
      rAway.push(doc.result.awayScore);
      rWinner.push(doc.result.winnerTeamId);
      rEt.push(doc.result.isExtraTime);
      rPen.push(doc.result.isPenalties);

      for (const per of doc.periods) {
        const curPeriodId = nextPeriodId++;
        pId.push(curPeriodId);
        pMatch.push(doc.matchId);
        pNum.push(per.periodNumber);
        pLabel.push(per.label);
        pHome.push(per.homeScore);
        pAway.push(per.awayScore);

        for (const [k, v] of Object.entries(per.homeStats)) {
          psPeriod.push(curPeriodId);
          psTeam.push(doc.homeTeam.id);
          psKey.push(k);
          psVal.push(v);
        }
        for (const [k, v] of Object.entries(per.awayStats)) {
          psPeriod.push(curPeriodId);
          psTeam.push(doc.awayTeam.id);
          psKey.push(k);
          psVal.push(v);
        }
      }

      for (const ln of doc.lineups) {
        const statEntries = Object.entries(ln.stats);
        lMatch.push(doc.matchId);
        lTeam.push(ln.teamId);
        lPlayer.push(ln.playerId);
        lStarter.push(ln.isStarter);
        lShirt.push(ln.shirtNumber);
        lRole.push(ln.role);
        lMin.push(ln.minutesPlayed);
        lRating.push(ln.rating);
        lPName.push(statEntries[0][0]);
        lPVal.push(statEntries[0][1]);
        lSName.push(statEntries[1][0]);
        lSVal.push(statEntries[1][1]);
      }

      for (const ev of doc.events) {
        eMatch.push(doc.matchId);
        eTeam.push(ev.teamId);
        ePlayer.push(ev.playerId);
        eAssist.push(ev.assistPlayerId);
        ePer.push(ev.periodNumber);
        eMin.push(ev.minute);
        eType.push(ev.type);
        eDesc.push(ev.description);
        eMName.push(ev.metric?.name ?? null);
        eMVal.push(ev.metric?.value ?? null);
      }
    }

    const tPg = performance.now();
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO matches (id, tournament_id, sport_id, venue_id, home_team_id, away_team_id, stage_name, scheduled_at, status, attendance)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::text[], $8::timestamptz[], $9::text[], $10::int[])`,
        [mId, mTour, mSport, mVenue, mHome, mAway, mStage, mSched, mStatus, mAttend]
      );
      await client.query(
        `INSERT INTO match_results (match_id, home_score, away_score, winner_team_id, is_extra_time, is_penalties)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::bool[], $6::bool[])`,
        [rMatch, rHome, rAway, rWinner, rEt, rPen]
      );
      await client.query(
        `INSERT INTO match_periods (id, match_id, period_number, period_label, home_score, away_score)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::text[], $5::int[], $6::int[])`,
        [pId, pMatch, pNum, pLabel, pHome, pAway]
      );
      await client.query(
        `INSERT INTO match_period_stats (period_id, team_id, stat_key, stat_value)
         SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::numeric[])`,
        [psPeriod, psTeam, psKey, psVal]
      );
      await client.query(
        `INSERT INTO match_lineups (match_id, team_id, player_id, is_starter, shirt_number, role, minutes_played, rating, primary_stat_name, primary_stat_val, secondary_stat_name, secondary_stat_val)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::bool[], $5::int[], $6::text[], $7::int[], $8::numeric[], $9::text[], $10::numeric[], $11::text[], $12::numeric[])`,
        [lMatch, lTeam, lPlayer, lStarter, lShirt, lRole, lMin, lRating, lPName, lPVal, lSName, lSVal]
      );
      await client.query(
        `INSERT INTO match_events (match_id, team_id, player_id, assist_player_id, period_number, minute, event_type, description, metric_name, metric_val)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::text[], $8::text[], $9::text[], $10::numeric[])`,
        [eMatch, eTeam, ePlayer, eAssist, ePer, eMin, eType, eDesc, eMName, eMVal]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    pgTimeMs += performance.now() - tPg;

    const tMongo = performance.now();
    await protocolsCol.insertMany(docs, { ordered: false });
    mongoTimeMs += performance.now() - tMongo;

    if (endId % 5000 === 0 || endId === TOTAL_MATCHES) {
      console.log(`   Залито ${endId.toLocaleString('uk-UA')} / ${TOTAL_MATCHES.toLocaleString('uk-UA')} матчів...`);
    }
  }

  await pgPool.query(`
    SELECT setval(pg_get_serial_sequence('sports', 'id'), (SELECT MAX(id) FROM sports));
    SELECT setval(pg_get_serial_sequence('venues', 'id'), (SELECT MAX(id) FROM venues));
    SELECT setval(pg_get_serial_sequence('tournaments', 'id'), (SELECT MAX(id) FROM tournaments));
    SELECT setval(pg_get_serial_sequence('teams', 'id'), (SELECT MAX(id) FROM teams));
    SELECT setval(pg_get_serial_sequence('players', 'id'), (SELECT MAX(id) FROM players));
    SELECT setval(pg_get_serial_sequence('matches', 'id'), (SELECT MAX(id) FROM matches));
    SELECT setval(pg_get_serial_sequence('match_periods', 'id'), (SELECT MAX(id) FROM match_periods));
  `);

  console.log('Створення індексів у PostgreSQL та MongoDB...');
  const tIdxPg = performance.now();
  await pgPool.query(indexesSql);
  const pgIdxMs = performance.now() - tIdxPg;

  const tIdxMongo = performance.now();
  await protocolsCol.createIndexes([
    { key: { matchId: 1 }, unique: true },
    { key: { sportCode: 1, scheduledAt: -1 } },
    { key: { 'tournament.id': 1, scheduledAt: -1 } },
    { key: { 'homeTeam.id': 1 } },
    { key: { 'awayTeam.id': 1 } },
    { key: { 'lineups.playerId': 1 } },
    { key: { 'events.playerId': 1, 'events.type': 1 } },
  ]);
  const mongoIdxMs = performance.now() - tIdxMongo;

  const countsRes = await pgPool.query<{ tbl: string; cnt: string }>(`
    SELECT 'matches' AS tbl, count(*)::text AS cnt FROM matches
    UNION ALL SELECT 'match_results', count(*)::text FROM match_results
    UNION ALL SELECT 'match_periods', count(*)::text FROM match_periods
    UNION ALL SELECT 'match_period_stats', count(*)::text FROM match_period_stats
    UNION ALL SELECT 'match_lineups', count(*)::text FROM match_lineups
    UNION ALL SELECT 'match_events', count(*)::text FROM match_events
  `);
  const mongoCount = await protocolsCol.countDocuments();

  console.log('\n=== Підсумок сидінгу ===');
  console.log(`PostgreSQL (вставка): ${(pgTimeMs / 1000).toFixed(2)} c | індекси: ${(pgIdxMs / 1000).toFixed(2)} c`);
  for (const row of countsRes.rows) {
    console.log(`   SQL ${row.tbl.padEnd(20)}: ${Number(row.cnt).toLocaleString('uk-UA')} рядків`);
  }
  console.log(`MongoDB (вставка):    ${(mongoTimeMs / 1000).toFixed(2)} c | індекси: ${(mongoIdxMs / 1000).toFixed(2)} c`);
  console.log(`   Mongo match_protocols  : ${mongoCount.toLocaleString('uk-UA')} документів`);
  console.log(`Загальний час: ${((performance.now() - totalStart) / 1000).toFixed(2)} c`);
}

main()
  .catch((err) => {
    console.error('Помилка сидінгу:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
    await closeMongo();
  });
