export const BIZZARO_F1_NAMES = [
  "Mex Verstoopin",
  "Lars Harmontron",
  "Sharl DeClare",
  "Carlo Standz",
  "Land O. Norizz",
  "Osco Pianistry",
  "Ferdinando Mendoslo",
  "Sergio Perezoom",
  "George Rumblesell",
  "Valtteri Bottastic",
  "Kimi Raikonfused",
  "Nico Hulkenblitz",
  "Pierre Gaspedal",
  "Esteban Oconic",
  "Yuki Tsunoodle",
  "Alex Albonzo",
  "Logan Sargroove",
  "Daniel Ricciardough",
  "Jenson Buttone",
  "Sebastian Kettle"
];

export function randomBizzaroName() {
  if (!BIZZARO_F1_NAMES.length) {
    return `Racer-${Math.floor(Math.random() * 10000)}`;
  }

  const index = Math.floor(Math.random() * BIZZARO_F1_NAMES.length);
  return BIZZARO_F1_NAMES[index];
}
