import { closeMongo, connectMongo } from './db.js';
import type { MatchProtocolDoc } from './models.js';

async function main(): Promise<void> {
  const { db } = await connectMongo();
  const protocols = db.collection<MatchProtocolDoc>('match_protocols');

  console.log('=== Пункт 3: Демонстрація роботи з MongoDB (match_protocols) ===\n');

  const footballMatch = await protocols.findOne({ sportCode: 'football' });
  const basketballMatch = await protocols.findOne({ sportCode: 'basketball' });
  const tennisMatch = await protocols.findOne({ sportCode: 'tennis' });

  if (!footballMatch || !basketballMatch || !tennisMatch) {
    throw new Error('Колекція порожня. Спочатку виконайте: npm run seed');
  }

  console.log('1. Поліморфна схема (різні метрики періодів у тій самій колекції):');
  console.log(
    `   Футбол (#${footballMatch.matchId}): ${footballMatch.homeTeam.name} ${footballMatch.result.homeScore}:${footballMatch.result.awayScore} ${footballMatch.awayTeam.name}`
  );
  console.log('     Період 1 homeStats:', footballMatch.periods[0].homeStats);

  console.log(
    `   Баскетбол (#${basketballMatch.matchId}): ${basketballMatch.homeTeam.name} ${basketballMatch.result.homeScore}:${basketballMatch.result.awayScore} ${basketballMatch.awayTeam.name}`
  );
  console.log('     Чверть 1 homeStats:', basketballMatch.periods[0].homeStats);

  console.log(
    `   Теніс (#${tennisMatch.matchId}): ${tennisMatch.homeTeam.name} ${tennisMatch.result.homeScore}:${tennisMatch.result.awayScore} ${tennisMatch.awayTeam.name}`
  );
  console.log('     Сет 1 homeStats:', tennisMatch.periods[0].homeStats);

  console.log('\n2. Додавання live-події в протокол футбольного матчу (#1):');
  const target = await protocols.findOne({ matchId: 1 });
  if (target) {
    const beforeScore = target.result.homeScore;
    await protocols.updateOne(
      { matchId: 1 },
      {
        $push: {
          events: {
            periodNumber: 2,
            minute: 90,
            teamId: target.homeTeam.id,
            playerId: target.lineups[0].playerId,
            playerName: target.lineups[0].playerName,
            assistPlayerId: null,
            assistPlayerName: null,
            type: 'goal',
            description: 'Демонстраційний гол на 90-й хвилині',
            metric: { name: 'xg', value: 0.91 },
          },
        },
        $inc: { 'result.homeScore': 1 },
      }
    );
    const updated = await protocols.findOne({ matchId: 1 });
    console.log(
      `   Рахунок господарів: ${beforeScore} -> ${updated?.result.homeScore}, всього подій: ${updated?.events.length}`
    );

    await protocols.updateOne(
      { matchId: 1 },
      {
        $pop: { events: 1 },
        $inc: { 'result.homeScore': -1 },
      }
    );
  }

  console.log('\n3. Розподіл матчів у колекції за видами спорту (Aggregation Pipeline):');
  const summary = await protocols
    .aggregate([
      {
        $group: {
          _id: '$sportName',
          matchesCount: { $sum: 1 },
          avgAttendance: { $avg: '$attendance' },
        },
      },
      { $sort: { matchesCount: -1 } },
    ])
    .toArray();

  for (const row of summary) {
    console.log(
      `   ${String(row._id).padEnd(12)}: ${row.matchesCount} матчів, середня відвідуваність: ${Math.round(row.avgAttendance)}`
    );
  }
}

main()
  .catch((err) => {
    console.error('Помилка MongoDB-демо:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
