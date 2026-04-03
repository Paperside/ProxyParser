export const fetchRulesByUrl = async (url: string): Promise<string[]> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  return text.split("\n").reduce<string[]>((accumulator, rule) => {
    const nextRule = rule.replaceAll(/(\n|\r|\r\n|↵)/g, "");

    if (
      nextRule.length !== 0 &&
      !(
        nextRule.startsWith("#") ||
        nextRule.startsWith("USER-AGENT") ||
        nextRule.startsWith("URL-REGEX")
      )
    ) {
      accumulator.push(nextRule);
    }

    return accumulator;
  }, []);
};
