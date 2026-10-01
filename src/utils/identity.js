// Presentation only: never use this value in credentials or API requests.
export function displayName(username = "") {
  return username
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\p{L}[\p{L}\p{M}]*/gu, (word) =>
      word === word.toLocaleLowerCase()
        ? word.charAt(0).toLocaleUpperCase() + word.slice(1)
        : word,
    );
}
