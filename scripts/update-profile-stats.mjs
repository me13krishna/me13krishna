import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const username = process.env.GITHUB_USERNAME ?? "me13krishna";
const outputDirectory = fileURLToPath(new URL("../assets/", import.meta.url));
const colors = ["#143D38", "#1F5C4D", "#48BFA3", "#9ADBC9", "#DCE8A8"];

async function fetchText(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}): ${url}`);
  }
  return response.text();
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}): ${url}`);
  }
  return response.json();
}

function getContributionCalendar(html) {
  const heading = html.match(
    /<h2\b[^>]*id="js-contribution-activity-description"[^>]*>([\s\S]*?)<\/h2>/i,
  );
  const summary = heading?.[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const totalMatch = summary?.match(/([\d,]+)\s+contributions?\s+in the last year/i);
  if (!totalMatch) {
    throw new Error("Could not read the annual contribution total from GitHub.");
  }

  const days = [];
  const cellPattern =
    /<td\b(?=[^>]*\bclass="[^"]*\bContributionCalendar-day\b[^"]*")[^>]*>/gi;
  for (const match of html.matchAll(cellPattern)) {
    const date = match[0].match(/\bdata-date="(\d{4}-\d{2}-\d{2})"/i)?.[1];
    const level = match[0].match(/\bdata-level="([0-4])"/i)?.[1];
    if (date && level !== undefined) {
      days.push({ date, level: Number(level) });
    }
  }

  if (days.length < 350 || days.length > 380) {
    throw new Error(`Expected about a year of contribution data; received ${days.length} days.`);
  }
  if (new Set(days.map(({ date }) => date)).size !== days.length) {
    throw new Error("GitHub contribution calendar contains duplicate dates.");
  }

  return { total: Number(totalMatch[1].replaceAll(",", "")), days };
}

function renderStatsSvg({ contributions, followers, repositories, stars }) {
  const metrics = [
    { label: "CONTRIBUTIONS · 12 MONTHS", value: contributions },
    { label: "PUBLIC REPOSITORIES", value: repositories },
    { label: "REPOSITORY STARS", value: stars },
    { label: "FOLLOWERS", value: followers },
  ];
  const cardWidth = 220;
  const gap = 14;
  const cards = metrics
    .map(({ label, value }, index) => {
      const x = 24 + index * (cardWidth + gap);
      return `<g transform="translate(${x} 52)"><rect width="${cardWidth}" height="98" rx="12" fill="#0B2A21" stroke="#1F5C4D"/><text x="18" y="31" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" letter-spacing="1">${label}</text><text x="18" y="74" fill="#FAFAF5" font-family="ui-sans-serif, system-ui, sans-serif" font-size="32" font-weight="650">${value.toLocaleString("en-US")}</text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="174" viewBox="0 0 960 174" fill="none" role="img" aria-labelledby="title desc"><title id="title">Live GitHub profile stats for ${username}</title><desc id="desc">${contributions} contributions in the last year, ${repositories} public repositories, ${stars} repository stars, and ${followers} followers.</desc><rect x="1" y="1" width="958" height="172" rx="18" fill="#071A14" stroke="#1F5C4D"/>${cards}<text x="24" y="163" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" letter-spacing="1">LIVE PUBLIC DATA · SOURCE: GITHUB</text></svg>\n`;
}

function renderContributionsSvg({ days, total }) {
  const sortedDays = [...days].sort((first, second) => first.date.localeCompare(second.date));
  const firstDate = new Date(`${sortedDays[0].date}T00:00:00Z`);
  if (firstDate.getUTCDay() !== 0) {
    throw new Error("GitHub contribution calendar does not begin on a Sunday.");
  }

  const daySize = 10;
  const cellGap = 4;
  const weekWidth = daySize + cellGap;
  const left = 77;
  const top = 64;
  const positions = sortedDays.map(({ date, level }) => {
    const dateValue = new Date(`${date}T00:00:00Z`);
    const offsetDays = Math.round((dateValue - firstDate) / 86_400_000);
    return {
      column: Math.floor(offsetDays / 7),
      row: dateValue.getUTCDay(),
      date,
      level,
    };
  });
  const weekCount = Math.max(...positions.map(({ column }) => column)) + 1;
  if (weekCount < 50 || weekCount > 55) {
    throw new Error(`Unexpected contribution calendar width: ${weekCount} weeks.`);
  }

  const cells = colors
    .map((color, level) => {
      const levelCells = positions
        .filter((day) => day.level === level)
        .map(({ column, row }) => {
          const x = left + column * weekWidth;
          const y = top + row * weekWidth;
          return `<rect x="${x}" y="${y}" width="${daySize}" height="${daySize}" rx="2"/>`;
        })
        .join("");
      return `<g fill="${color}">${levelCells}</g>`;
    })
    .join("");

  const monthLabels = [];
  let lastMonth = -1;
  for (let column = 0; column < weekCount; column += 1) {
    const weekDate = new Date(firstDate.getTime() + column * 7 * 86_400_000);
    if (weekDate.getUTCMonth() !== lastMonth) {
      monthLabels.push(
        `<text x="${left + column * weekWidth}" y="51" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${weekDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>`,
      );
      lastMonth = weekDate.getUTCMonth();
    }
  }

  const weekdayLabels = [
    { label: "Mon", row: 1 },
    { label: "Wed", row: 3 },
    { label: "Fri", row: 5 },
  ]
    .map(
      ({ label, row }) =>
        `<text x="34" y="${top + row * weekWidth + 9}" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">${label}</text>`,
    )
    .join("");

  const width = left + weekCount * weekWidth + 24;
  const height = top + 7 * weekWidth + 36;
  const legend = colors
    .map(
      (color, index) =>
        `<rect x="${width - 145 + index * 14}" y="${height - 17}" width="9" height="9" rx="2" fill="${color}"><title>Contribution level ${index}</title></rect>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" role="img" aria-labelledby="title desc"><title id="title">GitHub contributions over the past year</title><desc id="desc">${total} contributions over ${days.length} days, from ${sortedDays[0].date} to ${sortedDays.at(-1).date}. Colors show GitHub's contribution levels.</desc><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="16" fill="#071A14" stroke="#1F5C4D"/><text x="24" y="29" fill="#FAFAF5" font-family="ui-sans-serif, system-ui, sans-serif" font-size="15" font-weight="600">Contribution activity</text><text x="${width - 24}" y="29" text-anchor="end" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${total.toLocaleString("en-US")} contributions · past year</text>${weekdayLabels}${monthLabels.join("")}${cells}${legend}<text x="${width - 225}" y="${height - 9}" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">LESS</text><text x="${width - 68}" y="${height - 9}" fill="#9ADBC9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9">MORE</text></svg>\n`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to fetch live GitHub API data.");
  }

  const apiHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [profile, contributionsHtml] = await Promise.all([
    fetchJson(`https://api.github.com/users/${username}`, apiHeaders),
    fetchText(`https://github.com/users/${username}/contributions`, {
      "User-Agent": `${username}-profile-readme-stats`,
    }),
  ]);
  const { total: contributions, days } = getContributionCalendar(contributionsHtml);
  const repositories = [];
  let repositoriesUrl = `https://api.github.com/users/${username}/repos?type=owner&per_page=100&sort=updated`;

  while (repositoriesUrl) {
    const response = await fetch(repositoriesUrl, { headers: apiHeaders });
    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status}): ${repositoriesUrl}`);
    }
    repositories.push(...(await response.json()));
    const nextLink = response.headers
      .get("link")
      ?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    repositoriesUrl = nextLink ?? "";
  }

  if (!Number.isInteger(profile.public_repos) || !Number.isInteger(profile.followers)) {
    throw new Error("GitHub profile API returned unexpected public profile data.");
  }
  if (repositories.length !== profile.public_repos) {
    throw new Error(
      `Fetched ${repositories.length} repositories, but GitHub reports ${profile.public_repos}.`,
    );
  }
  if (repositories.some(({ stargazers_count }) => !Number.isInteger(stargazers_count))) {
    throw new Error("GitHub repository API returned an invalid star count.");
  }

  const stars = repositories.reduce((sum, repository) => sum + repository.stargazers_count, 0);
  const statsSvg = renderStatsSvg({
    contributions,
    followers: profile.followers,
    repositories: profile.public_repos,
    stars,
  });
  const contributionsSvg = renderContributionsSvg({ days, total: contributions });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "github-stats.svg"), statsSvg),
    writeFile(path.join(outputDirectory, "github-contributions.svg"), contributionsSvg),
  ]);
  console.log(
    `Updated GitHub stats: ${contributions} contributions, ${profile.public_repos} repositories, ${stars} stars, ${profile.followers} followers.`,
  );
}

main().catch((error) => {
  console.error("Failed to update GitHub profile stats:", error);
  process.exitCode = 1;
});
