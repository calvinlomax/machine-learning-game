export const BIZZARO_F1_NAMES = [
  "Max Verstoppin",
  "Lewis Hamiltron",
  "Charles Leclonk",
  "Carlos Sainzter",
  "Lando Norrizzle",
  "Oscar Piastriq",
  "Fernando Alonslow",
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
  "Sebastian Vettlestar"
];

export function randomBizzaroName() {
  if (!BIZZARO_F1_NAMES.length) {
    return `Racer-${Math.floor(Math.random() * 10000)}`;
  }

  const index = Math.floor(Math.random() * BIZZARO_F1_NAMES.length);
  return BIZZARO_F1_NAMES[index];
}
