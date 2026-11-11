import { closeMongo, connectMongo, pgPool } from './db.js';
import { buildReferenceData, createRng, generateMatchProtocol } from './generator.js';
import type { MatchProtocolDoc } from './models.js';

interface BenchStats {
  name: string;
  pgAvgMs: number;
  pgP50Ms: number;
  pgP95Ms: number;
  pgP99Ms: number;
  mongoAvgMs: number;
  mongoP50Ms: number;
  mongoP95Ms: number;
  mongoP99Ms: number;
  extraNote: string;
}

function calcStats(timesMs: number[]): {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    avg: sum / sorted.length,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/** Виводить у консоль вирівняну таблицю результатів бенчмарку. */
function printSummaryTable(results: BenchStats[]): void {
  const headers = ['Тест', 'PG avg', 'PG p95', 'Mongo avg', 'Mongo p95', 'Порівняння'] as const;
  const rows = results.map((r) => [
    r.name,
    fmt(r.pgAvgMs),
    fmt(r.pgP95Ms),
    fmt(r.mongoAvgMs),
    fmt(r.mongoP95Ms),
    r.extraNote,
  ]);
  const rightAlign = [false, true, true, true, true, false];

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length))
  );

  const makeBorder = (left: string, mid: string, right: string) =>
    left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const formatRow = (cells: readonly string[]) =>
    '│ ' +
    cells
      .map((cell, i) => (rightAlign[i] ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
      .join(' │ ') +
    ' │';

  console.log('Зведена таблиця результатів (час у мс):');
  console.log(makeBorder('┌', '┬', '┐'));
  console.log(formatRow(headers));
  console.log(makeBorder('├', '┼', '┤'));
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(makeBorder('└', '┴', '┘'));
}

const PG_READ_PROTOCOL_SQL = `
  SELECT
    m.id, m.stage_name, m.scheduled_at, m.status, m.attendance,
    s.code AS sport_code, s.name AS sport_name,
    tr.id AS tournament_id, tr.name AS tournament_name, tr.season,
    v.id AS venue_id, v.name AS venue_name, v.city AS venue_city, v.capacity,
    ht.id AS home_team_id, ht.name AS home_team_name, ht.city AS home_team_city,
    aw.id AS away_team_id, aw.name AS away_team_name, aw.city AS away_team_city,
    mr.home_score, mr.away_score, mr.winner_team_id, mr.is_extra_time, mr.is_penalties,
    COALESCE((
      SELECT json_agg(json_build_object(
        'periodNumber', mp.period_number,
        'label', mp.period_label,
        'homeScore', mp.home_score,
        'awayScore', mp.away_score,
        'stats', (
          SELECT json_agg(json_build_object('teamId', mps.team_id, 'key', mps.stat_key, 'value', mps.stat_value))
          FROM match_period_stats mps WHERE mps.period_id = mp.id
        )
      ) ORDER BY mp.period_number)
      FROM match_periods mp WHERE mp.match_id = m.id
    ), '[]'::json) AS periods,
    COALESCE((
      SELECT json_agg(json_build_object(
        'teamId', ml.team_id, 'playerId', ml.player_id, 'playerName', p.full_name,
        'isStarter', ml.is_starter, 'shirtNumber', ml.shirt_number, 'role', ml.role,
        'minutesPlayed', ml.minutes_played, 'rating', ml.rating,
        'primaryStat', ml.primary_stat_name, 'primaryVal', ml.primary_stat_val,
        'secondaryStat', ml.secondary_stat_name, 'secondaryVal', ml.secondary_stat_val
      ))
      FROM match_lineups ml
      JOIN players p ON p.id = ml.player_id
      WHERE ml.match_id = m.id
    ), '[]'::json) AS lineups,
    COALESCE((
      SELECT json_agg(json_build_object(
        'periodNumber', me.period_number, 'minute', me.minute, 'teamId', me.team_id,
        'playerId', me.player_id, 'playerName', p.full_name,
        'assistPlayerId', me.assist_player_id, 'assistPlayerName', ap.full_name,
        'type', me.event_type, 'description', me.description,
        'metricName', me.metric_name, 'metricVal', me.metric_val
      ) ORDER BY me.period_number, me.minute)
      FROM match_events me
      JOIN players p ON p.id = me.player_id
      LEFT JOIN players ap ON ap.id = me.assist_player_id
      WHERE me.match_id = m.id
    ), '[]'::json) AS events
  FROM matches m
  JOIN sports s ON s.id = m.sport_id
  JOIN tournaments tr ON tr.id = m.tournament_id
  JOIN venues v ON v.id = m.venue_id
  JOIN teams ht ON ht.id = m.home_team_id
  JOIN teams aw ON aw.id = m.away_team_id
  JOIN match_results mr ON mr.match_id = m.id
  WHERE m.id = $1
`;

async function insertMatchPg(sportId: number, doc: MatchProtocolDoc): Promise<number> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const mRes = await client.query<{ id: number }>(
      `INSERT INTO matches (tournament_id, sport_id, venue_id, home_team_id, away_team_id, stage_name, scheduled_at, status, attendance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        doc.tournament.id,
        sportId,
        doc.venue.id,
        doc.homeTeam.id,
        doc.awayTeam.id,
        doc.stageName,
        doc.scheduledAt,
        doc.status,
        doc.attendance,
      ]
    );
    const matchId = mRes.rows[0].id;

    await client.query(
      `INSERT INTO match_results (match_id, home_score, away_score, winner_team_id, is_extra_time, is_penalties)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        matchId,
        doc.result.homeScore,
        doc.result.awayScore,
        doc.result.winnerTeamId,
        doc.result.isExtraTime,
        doc.result.isPenalties,
      ]
    );

    const pRes = await client.query<{ id: number; period_number: number }>(
      `INSERT INTO match_periods (match_id, period_number, period_label, home_score, away_score)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::int[], $5::int[])
       RETURNING id, period_number`,
      [
        doc.periods.map(() => matchId),
        doc.periods.map((p) => p.periodNumber),
        doc.periods.map((p) => p.label),
        doc.periods.map((p) => p.homeScore),
        doc.periods.map((p) => p.awayScore),
      ]
    );
    const periodIdByNum = new Map(pRes.rows.map((r) => [r.period_number, r.id]));

    const psPeriod: number[] = [];
    const psTeam: number[] = [];
    const psKey: string[] = [];
    const psVal: number[] = [];
    for (const per of doc.periods) {
      const pid = periodIdByNum.get(per.periodNumber)!;
      for (const [k, v] of Object.entries(per.homeStats)) {
        psPeriod.push(pid);
        psTeam.push(doc.homeTeam.id);
        psKey.push(k);
        psVal.push(v);
      }
      for (const [k, v] of Object.entries(per.awayStats)) {
        psPeriod.push(pid);
        psTeam.push(doc.awayTeam.id);
        psKey.push(k);
        psVal.push(v);
      }
    }
    await client.query(
      `INSERT INTO match_period_stats (period_id, team_id, stat_key, stat_value)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::numeric[])`,
      [psPeriod, psTeam, psKey, psVal]
    );

    await client.query(
      `INSERT INTO match_lineups (match_id, team_id, player_id, is_starter, shirt_number, role, minutes_played, rating, primary_stat_name, primary_stat_val, secondary_stat_name, secondary_stat_val)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::bool[], $5::int[], $6::text[], $7::int[], $8::numeric[], $9::text[], $10::numeric[], $11::text[], $12::numeric[])`,
      [
        doc.lineups.map(() => matchId),
        doc.lineups.map((l) => l.teamId),
        doc.lineups.map((l) => l.playerId),
        doc.lineups.map((l) => l.isStarter),
        doc.lineups.map((l) => l.shirtNumber),
        doc.lineups.map((l) => l.role),
        doc.lineups.map((l) => l.minutesPlayed),
        doc.lineups.map((l) => l.rating),
        doc.lineups.map((l) => Object.entries(l.stats)[0][0]),
        doc.lineups.map((l) => Object.entries(l.stats)[0][1]),
        doc.lineups.map((l) => Object.entries(l.stats)[1][0]),
        doc.lineups.map((l) => Object.entries(l.stats)[1][1]),
      ]
    );

    await client.query(
      `INSERT INTO match_events (match_id, team_id, player_id, assist_player_id, period_number, minute, event_type, description, metric_name, metric_val)
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::text[], $8::text[], $9::text[], $10::numeric[])`,
      [
        doc.events.map(() => matchId),
        doc.events.map((e) => e.teamId),
        doc.events.map((e) => e.playerId),
        doc.events.map((e) => e.assistPlayerId),
        doc.events.map((e) => e.periodNumber),
        doc.events.map((e) => e.minute),
        doc.events.map((e) => e.type),
        doc.events.map((e) => e.description),
        doc.events.map((e) => e.metric?.name ?? null),
        doc.events.map((e) => e.metric?.value ?? null),
      ]
    );

    await client.query('COMMIT');
    return matchId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function runConcurrentReads(
  ids: number[],
  concurrency: number,
  workerFn: (id: number) => Promise<unknown>
): Promise<{ totalMs: number; latMs: number[] }> {
  let cursor = 0;
  const latMs: number[] = new Array(ids.length);
  const startAll = performance.now();

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= ids.length) break;
      const t0 = performance.now();
      await workerFn(ids[idx]);
      latMs[idx] = performance.now() - t0;
    }
  });

  await Promise.all(workers);
  return { totalMs: performance.now() - startAll, latMs };
}

async function main(): Promise<void> {
  const { db: mongoDb } = await connectMongo();
  const protocolsCol = mongoDb.collection<MatchProtocolDoc>('match_protocols');

  const maxMatchRow = await pgPool.query<{ max_id: number; cnt: string }>(
    'SELECT COALESCE(MAX(id), 0)::int AS max_id, count(*)::text AS cnt FROM matches'
  );
  const baseMaxMatchId = maxMatchRow.rows[0].max_id;
  const totalMatches = Number(maxMatchRow.rows[0].cnt);
  const mongoCount = await protocolsCol.countDocuments();

  if (totalMatches === 0 || mongoCount === 0) {
    throw new Error('Бази порожні. Спочатку запустіть: npm run seed');
  }

  console.log(
    `=== Тестування швидкодії PostgreSQL vs MongoDB (${totalMatches.toLocaleString('uk-UA')} матчів) ===\n`
  );

  const rng = createRng(999);
  const pickMatchIds = (count: number) =>
    Array.from({ length: count }, () => Math.floor(rng() * baseMaxMatchId) + 1);
  const pickPlayerIds = (count: number) =>
    Array.from({ length: count }, () => Math.floor(rng() * 1800) + 1);

  const results: BenchStats[] = [];

  // Тест 1: Послідовне читання повного протоколу матчу за ID
  {
    const warmupIds = pickMatchIds(50);
    const testIds = pickMatchIds(300);

    for (const id of warmupIds) {
      await pgPool.query(PG_READ_PROTOCOL_SQL, [id]);
      await protocolsCol.findOne({ matchId: id });
    }

    const pgTimes: number[] = [];
    for (const id of testIds) {
      const t0 = performance.now();
      await pgPool.query(PG_READ_PROTOCOL_SQL, [id]);
      pgTimes.push(performance.now() - t0);
    }

    const mongoTimes: number[] = [];
    for (const id of testIds) {
      const t0 = performance.now();
      await protocolsCol.findOne({ matchId: id });
      mongoTimes.push(performance.now() - t0);
    }

    const pgS = calcStats(pgTimes);
    const mgS = calcStats(mongoTimes);
    results.push({
      name: '1. Читання протоколу (300x)',
      pgAvgMs: pgS.avg,
      pgP50Ms: pgS.p50,
      pgP95Ms: pgS.p95,
      pgP99Ms: pgS.p99,
      mongoAvgMs: mgS.avg,
      mongoP50Ms: mgS.p50,
      mongoP95Ms: mgS.p95,
      mongoP99Ms: mgS.p99,
      extraNote: `Mongo швидше в ${(pgS.avg / mgS.avg).toFixed(1)}x`,
    });
  }

  // Тест 2: Паралельне читання (20 одночасних клієнтів, 1 000 запитів)
  {
    const testIds = pickMatchIds(1000);
    const pgConc = await runConcurrentReads(testIds, 20, (id) =>
      pgPool.query(PG_READ_PROTOCOL_SQL, [id])
    );
    const mgConc = await runConcurrentReads(testIds, 20, (id) =>
      protocolsCol.findOne({ matchId: id })
    );

    const pgS = calcStats(pgConc.latMs);
    const mgS = calcStats(mgConc.latMs);
    const pgRps = (testIds.length / (pgConc.totalMs / 1000)).toFixed(0);
    const mgRps = (testIds.length / (mgConc.totalMs / 1000)).toFixed(0);

    results.push({
      name: '2. Читання в 20 потоків (1000x)',
      pgAvgMs: pgS.avg,
      pgP50Ms: pgS.p50,
      pgP95Ms: pgS.p95,
      pgP99Ms: pgS.p99,
      mongoAvgMs: mgS.avg,
      mongoP50Ms: mgS.p50,
      mongoP95Ms: mgS.p95,
      mongoP99Ms: mgS.p99,
      extraNote: `PG: ${pgRps} vs Mongo: ${mgRps} req/s`,
    });
  }

  // Тест 3: Вставка нового повного протоколу матчу (100x, warm-up 15)
  {
    const refs = buildReferenceData();
    const totalToInsert = 115;
    const generated = Array.from({ length: totalToInsert }, (_, idx) =>
      generateMatchProtocol(baseMaxMatchId + idx + 1, refs, rng)
    );

    const pgTimes: number[] = [];
    for (let i = 0; i < totalToInsert; i++) {
      const t0 = performance.now();
      await insertMatchPg(generated[i].sportId, generated[i].doc);
      const elapsed = performance.now() - t0;
      if (i >= 15) pgTimes.push(elapsed);
    }

    const mongoTimes: number[] = [];
    for (let i = 0; i < totalToInsert; i++) {
      const docCopy = structuredClone(generated[i].doc);
      const t0 = performance.now();
      await protocolsCol.insertOne(docCopy);
      const elapsed = performance.now() - t0;
      if (i >= 15) mongoTimes.push(elapsed);
    }

    await pgPool.query('DELETE FROM matches WHERE id > $1', [baseMaxMatchId]);
    await pgPool.query(
      "SELECT setval(pg_get_serial_sequence('matches', 'id'), $1)",
      [baseMaxMatchId]
    );
    await protocolsCol.deleteMany({ matchId: { $gt: baseMaxMatchId } });

    const pgS = calcStats(pgTimes);
    const mgS = calcStats(mongoTimes);
    results.push({
      name: '3. Запис повного протоколу (100x)',
      pgAvgMs: pgS.avg,
      pgP50Ms: pgS.p50,
      pgP95Ms: pgS.p95,
      pgP99Ms: pgS.p99,
      mongoAvgMs: mgS.avg,
      mongoP50Ms: mgS.p50,
      mongoP95Ms: mgS.p95,
      mongoP99Ms: mgS.p99,
      extraNote: `Mongo швидше в ${(pgS.avg / mgS.avg).toFixed(1)}x`,
    });
  }

  // Тест 4: Агрегація статистики гравця за всі сезони (100x, warm-up 15)
  {
    const warmupPlayers = pickPlayerIds(15);
    const testPlayers = pickPlayerIds(100);

    const pgAggSql = `
      SELECT m.sport_id,
             count(*)::int AS matches_played,
             round(avg(ml.rating), 2) AS avg_rating,
             sum(ml.minutes_played)::int AS total_minutes,
             sum(ml.primary_stat_val)::numeric AS total_primary
      FROM match_lineups ml
      JOIN matches m ON m.id = ml.match_id
      WHERE ml.player_id = $1
      GROUP BY m.sport_id
    `;

    const runMongoAgg = (playerId: number) =>
      protocolsCol
        .aggregate([
          { $match: { 'lineups.playerId': playerId } },
          { $unwind: '$lineups' },
          { $match: { 'lineups.playerId': playerId } },
          {
            $group: {
              _id: '$sportCode',
              matchesPlayed: { $sum: 1 },
              avgRating: { $avg: '$lineups.rating' },
              totalMinutes: { $sum: '$lineups.minutesPlayed' },
            },
          },
        ])
        .toArray();

    for (const pid of warmupPlayers) {
      await pgPool.query(pgAggSql, [pid]);
      await runMongoAgg(pid);
    }

    const pgTimes: number[] = [];
    for (const pid of testPlayers) {
      const t0 = performance.now();
      await pgPool.query(pgAggSql, [pid]);
      pgTimes.push(performance.now() - t0);
    }

    const mongoTimes: number[] = [];
    for (const pid of testPlayers) {
      const t0 = performance.now();
      await runMongoAgg(pid);
      mongoTimes.push(performance.now() - t0);
    }

    const pgS = calcStats(pgTimes);
    const mgS = calcStats(mongoTimes);
    const winner =
      pgS.avg < mgS.avg
        ? `PG швидше в ${(mgS.avg / pgS.avg).toFixed(1)}x`
        : `Mongo швидше в ${(pgS.avg / mgS.avg).toFixed(1)}x`;

    results.push({
      name: '4. Агрегація по гравцю (100x)',
      pgAvgMs: pgS.avg,
      pgP50Ms: pgS.p50,
      pgP95Ms: pgS.p95,
      pgP99Ms: pgS.p99,
      mongoAvgMs: mgS.avg,
      mongoP50Ms: mgS.p50,
      mongoP95Ms: mgS.p95,
      mongoP99Ms: mgS.p99,
      extraNote: winner,
    });
  }

  // Тест 5: Перейменування команди (нормалізація vs денормалізація, 20x)
  {
    const refs = buildReferenceData();
    const pgTimes: number[] = [];
    const mongoTimes: number[] = [];

    for (let i = 0; i < 20; i++) {
      const team = refs.teams[i];
      const newName = `${team.name} (Ребрендинг)`;

      const tPg = performance.now();
      await pgPool.query('UPDATE teams SET name = $1 WHERE id = $2', [newName, team.id]);
      pgTimes.push(performance.now() - tPg);

      const tMg = performance.now();
      await protocolsCol.updateMany(
        { 'homeTeam.id': team.id },
        { $set: { 'homeTeam.name': newName } }
      );
      await protocolsCol.updateMany(
        { 'awayTeam.id': team.id },
        { $set: { 'awayTeam.name': newName } }
      );
      mongoTimes.push(performance.now() - tMg);

      await pgPool.query('UPDATE teams SET name = $1 WHERE id = $2', [team.name, team.id]);
      await protocolsCol.updateMany(
        { 'homeTeam.id': team.id },
        { $set: { 'homeTeam.name': team.name } }
      );
      await protocolsCol.updateMany(
        { 'awayTeam.id': team.id },
        { $set: { 'awayTeam.name': team.name } }
      );
    }

    const pgS = calcStats(pgTimes);
    const mgS = calcStats(mongoTimes);
    results.push({
      name: '5. Перейменування команди (20x)',
      pgAvgMs: pgS.avg,
      pgP50Ms: pgS.p50,
      pgP95Ms: pgS.p95,
      pgP99Ms: pgS.p99,
      mongoAvgMs: mgS.avg,
      mongoP50Ms: mgS.p50,
      mongoP95Ms: mgS.p95,
      mongoP99Ms: mgS.p99,
      extraNote: `PG швидше в ${(mgS.avg / pgS.avg).toFixed(1)}x`,
    });
  }

  printSummaryTable(results);

  const pgExplain = await pgPool.query<{ 'QUERY PLAN': string }>(
    'EXPLAIN (ANALYZE, BUFFERS) ' + PG_READ_PROTOCOL_SQL,
    [100]
  );
  const mongoExplain = (await protocolsCol
    .find({ matchId: 100 })
    .explain('executionStats')) as Record<string, any>;

  console.log('\n=== Перевірка індексів для matchId = 100 ===');
  const pgPlanLines = pgExplain.rows.map((r) => r['QUERY PLAN']);
  const execLine = pgPlanLines.find((l) => l.includes('Execution Time')) ?? '';
  const matchTableScans = pgPlanLines.filter((l) =>
    /(?:Index Only Scan|Index Scan|Bitmap Heap Scan|Seq Scan)\b.*\bon (?:matches|match_results|match_periods|match_period_stats|match_lineups|match_events)\b|Bitmap Index Scan on (?:ix_match_|match_)/.test(
      l
    )
  );
  console.log(`PostgreSQL: ${execLine.trim()}`);
  for (const line of matchTableScans) {
    console.log(`  ${line.trim().replace(/^->\s*/, '')}`);
  }

  const mongoStages: string[] = [];
  let mongoIndexName: string | undefined;
  let stageNode = mongoExplain.queryPlanner?.winningPlan;
  while (stageNode) {
    if (typeof stageNode.stage === 'string') {
      mongoStages.push(stageNode.stage);
    }
    if (typeof stageNode.indexName === 'string') {
      mongoIndexName = stageNode.indexName;
    }
    stageNode = stageNode.inputStage;
  }
  console.log(
    `MongoDB:    plan=${mongoStages.join(' -> ') || 'UNKNOWN'}${mongoIndexName ? ` (${mongoIndexName})` : ''}, ` +
      `docsExamined=${mongoExplain.executionStats?.totalDocsExamined}, ` +
      `executionTimeMillis=${mongoExplain.executionStats?.executionTimeMillis}`
  );
}

main()
  .catch((err) => {
    console.error('Помилка бенчмарку:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
    await closeMongo();
  });
