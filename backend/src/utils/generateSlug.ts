export const generateSlug = (str: string) => {

    return str
    .toLowerCase()
    .trim()
    .replace(/&/g,'and')
    .replace(/[^a-z,0-9]+/g, '-')
    .replace(/^-+|-+$/g, "")

}