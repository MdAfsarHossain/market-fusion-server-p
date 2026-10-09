export default (filename: string): string => {
  return filename
    .toLowerCase()
    .trim()
    .replace(/ /g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const slugify2 = (filename: string): string => {
  return filename
    .toLowerCase()
    .trim()
    .split(" ") // Split the string into words
    .sort() // Sort the words alphabetically
    .join("-") // Join them back with dashes
    .replace(/[^\w-]+/g, "") // Remove non-alphanumeric characters
    .replace(/-+/g, "-") // Replace multiple dashes with one
    .replace(/^-+|-+$/g, ""); // Remove leading and trailing dashes
};

export { slugify2 };
