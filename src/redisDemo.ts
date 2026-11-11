import { createRedisClient, pgPool } from './db.js';

async function main(): Promise<void> {
  const redis = createRedisClient();
  await redis.connect();

  try {
    console.log('=== Пункт 6: Демонстрація базових запитів у Redis (Key-Value) ===\n');

    console.log('1. Тимчасове бронювання місця з TTL (SET ... EX 600 NX):');
    const seatKey = 'seat_hold:match:100:A-15';
    await redis.del(seatKey);

    const fan1Lock = await redis.set(seatKey, 'user:13', 'EX', 600, 'NX');
    const fan2Lock = await redis.set(seatKey, 'user:14', 'EX', 600, 'NX');
    const ttlLeft = await redis.ttl(seatKey);

    console.log(`   Покупець #13 бронює місце A-15: ${fan1Lock === 'OK' ? 'Успішно заблоковано' : 'Відмова'}`);
    console.log(`   Покупець #14 намагається взяти те саме місце: ${fan2Lock === null ? 'Відмова (вже зайнято)' : 'OK'}`);
    console.log(`   Залишок часу броні (TTL): ${ttlLeft} сек`);

    await redis.del(seatKey);

    console.log('\n2. Live-табло матчу у Redis Hash (HSET / HINCRBY / HGETALL):');
    const liveKey = 'live_match:100';
    await redis.del(liveKey);

    await redis.hset(liveKey, {
      homeTeam: 'ФК Київ 1',
      awayTeam: 'СК Львів 2',
      homeScore: '0',
      awayScore: '0',
      minute: '1',
      status: 'in_progress',
    });

    await redis.hincrby(liveKey, 'homeScore', 1);
    await redis.hset(liveKey, 'minute', '23');
    await redis.hincrby(liveKey, 'awayScore', 1);
    await redis.hincrby(liveKey, 'homeScore', 1);
    await redis.hset(liveKey, 'minute', '78');

    const scoreboard = await redis.hgetall(liveKey);
    console.log(
      `   Табло: ${scoreboard.homeTeam} ${scoreboard.homeScore}:${scoreboard.awayScore} ${scoreboard.awayTeam} (${scoreboard.minute}')`
    );

    console.log('\n3. Таблиця бомбардирів у Sorted Set (ZADD / ZINCRBY / ZREVRANGE):');
    const boardKey = 'leaderboard:tournament:1:goals';
    await redis.del(boardKey);

    await redis.zadd(
      boardKey,
      5,
      'Андрій Шевченко',
      4,
      'Максим Коваленко',
      3,
      'Дмитро Мельник',
      2,
      'Артем Бондаренко'
    );
    await redis.zincrby(boardKey, 2, 'Максим Коваленко');

    const top3 = await redis.zrevrange(boardKey, 0, 2, 'WITHSCORES');
    console.log('   Топ-3 бомбардири:');
    for (let i = 0; i < top3.length; i += 2) {
      console.log(`     #${i / 2 + 1} ${top3[i]} — ${top3[i + 1]} голів`);
    }
    const rank = await redis.zrevrank(boardKey, 'Андрій Шевченко');
    console.log(`   Поточне місце Андрія Шевченка: #${rank !== null ? rank + 1 : '-'}`);


    console.log('\n4. Кешування результату SQL-агрегації (Cache-Aside з TTL 30с):');
    const cacheKey = 'cache:tournament:1:top_teams';
    await redis.del(cacheKey);

    const tMiss = performance.now();
    let cached = await redis.get(cacheKey);
    if (!cached) {
      const sqlRes = await pgPool.query(
        `SELECT t.name, count(*)::int AS wins
         FROM match_results mr
         JOIN matches m ON m.id = mr.match_id
         JOIN teams t ON t.id = mr.winner_team_id
         WHERE m.tournament_id = 1
         GROUP BY t.id, t.name
         ORDER BY wins DESC
         LIMIT 5`
      );
      cached = JSON.stringify(sqlRes.rows);
      await redis.setex(cacheKey, 30, cached);
    }
    const missMs = performance.now() - tMiss;

    const tHit = performance.now();
    const fromCache = await redis.get(cacheKey);
    const hitMs = performance.now() - tHit;

    const parsed = JSON.parse(fromCache!) as Array<{ name: string; wins: number }>;
    console.log(`   Cache MISS (SQL + запис у Redis): ${missMs.toFixed(2)} мс`);
    console.log(`   Cache HIT  (читання з Redis):     ${hitMs.toFixed(2)} мс`);
    console.log(`   Топ-команда турніру #1: ${parsed[0]?.name} (${parsed[0]?.wins} перемог)`);
  } finally {
    await redis.quit();
    await pgPool.end();
  }
}

main().catch((err) => {
  console.error('Помилка Redis-демо:', err);
  process.exitCode = 1;
});
