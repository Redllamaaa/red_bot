export function birthdayOccursOn(month, day, now) {
  const todayMonth = now.getUTCMonth() + 1;
  const todayDay = now.getUTCDate();
  const leapDayFallback =
    todayMonth === 2 &&
    todayDay === 28 &&
    new Date(Date.UTC(now.getUTCFullYear(), 1, 29)).getUTCMonth() !== 1;

  return (
    (month === todayMonth && day === todayDay) ||
    (leapDayFallback && month === 2 && day === 29)
  );
}

export async function processBirthday(birthday, now, year, send, markSent) {
  try {
    await send(birthday);
    await markSent(year, now.toISOString(), birthday.id);
  } catch (err) {
    console.error(`Failed to send birthday ${birthday.id}:`, err.message);
  }
}
