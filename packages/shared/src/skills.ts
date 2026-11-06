// Canonical skill names with the spellings seen in job descriptions and CVs.
// Matching is case-insensitive and respects word boundaries.
export const SKILLS: { name: string; variants: string[] }[] = [
  { name: "Java", variants: ["core java", "java 8", "java8", "java 11"] },
  { name: "J2EE", variants: ["java ee", "jee"] },
  { name: "Spring Boot", variants: ["springboot", "spring-boot"] },
  { name: "Spring Security", variants: ["spring-security"] },
  { name: "Spring MVC", variants: ["spring-mvc"] },
  { name: "Spring Cloud", variants: ["spring-cloud"] },
  { name: "Spring Data JPA", variants: ["spring data", "spring-data-jpa"] },
  { name: "Hibernate", variants: ["hibernate orm"] },
  { name: "JPA", variants: ["java persistence api"] },
  {
    name: "Microservices",
    variants: [
      "microservice",
      "micro services",
      "micro-services",
      "microservices architecture",
    ],
  },
  {
    name: "REST APIs",
    variants: [
      "rest api",
      "restful",
      "restful apis",
      "restful services",
      "rest services",
      "rest web services",
    ],
  },
  { name: "SQL", variants: [] },
  { name: "MySQL", variants: ["my sql"] },
  { name: "PostgreSQL", variants: ["postgres", "postgresql db"] },
  { name: "Oracle", variants: ["oracle db", "oracle sql"] },
  { name: "MongoDB", variants: ["mongo db", "mongo"] },
  { name: "Redis", variants: [] },
  { name: "Kafka", variants: ["apache kafka"] },
  { name: "RabbitMQ", variants: ["rabbit mq"] },
  { name: "AWS", variants: ["amazon web services"] },
  { name: "Azure", variants: ["microsoft azure"] },
  { name: "GCP", variants: ["google cloud"] },
  { name: "Docker", variants: ["containerization", "containerisation"] },
  { name: "Kubernetes", variants: ["k8s"] },
  { name: "Terraform", variants: [] },
  { name: "Jenkins", variants: [] },
  { name: "CI/CD", variants: ["cicd", "ci cd", "ci-cd"] },
  { name: "Git", variants: ["github", "gitlab"] },
  { name: "Maven", variants: [] },
  { name: "JUnit", variants: ["junit 5"] },
  { name: "Mockito", variants: [] },
  { name: "JavaScript", variants: ["js", "ecmascript"] },
  { name: "TypeScript", variants: [] },
  { name: "React", variants: ["reactjs", "react.js"] },
  { name: "Angular", variants: ["angularjs"] },
  { name: "Node.js", variants: ["nodejs", "node js"] },
  { name: "Python", variants: [] },
  {
    name: "KYC",
    variants: ["know your customer", "kyc processes", "kyc norms", "video kyc"],
  },
  {
    name: "AML checks",
    variants: [
      "aml",
      "anti money laundering",
      "anti-money laundering",
      "aml screening",
    ],
  },
  {
    name: "Customer due diligence",
    variants: ["cdd", "customer due-diligence"],
  },
  { name: "Enhanced due diligence", variants: ["edd"] },
  {
    name: "Sanctions screening",
    variants: ["sanctions", "watchlist screening", "sanction screening"],
  },
  { name: "Transaction monitoring", variants: ["alert review"] },
  {
    name: "MS Excel",
    variants: [
      "excel",
      "advanced excel",
      "microsoft excel",
      "ms-excel",
      "ms excel",
    ],
  },
  { name: "Pivot tables", variants: ["pivot table", "pivots", "pivot"] },
  { name: "VLOOKUP", variants: ["lookups", "xlookup"] },
  { name: "MIS reporting", variants: ["mis", "mis reports"] },
  { name: "Document verification", variants: ["document checks"] },
  {
    name: "P&L management",
    variants: [
      "p&l",
      "p & l",
      "p and l",
      "profit and loss",
      "profit & loss",
      "store p&l",
    ],
  },
  {
    name: "Inventory management",
    variants: [
      "inventory control",
      "stock control",
      "inventory planning",
      "stock management",
    ],
  },
  {
    name: "Team handling",
    variants: [
      "people handling",
      "team management",
      "people management",
      "handling a team",
    ],
  },
  {
    name: "Visual merchandising",
    variants: ["merchandising", "visual merchandiser"],
  },
  {
    name: "POS systems",
    variants: ["pos", "point of sale", "pos software", "billing software"],
  },
  { name: "Shrinkage control", variants: ["shrinkage"] },
  { name: "Vendor management", variants: ["vendor handling"] },
  { name: "Store operations", variants: ["store management"] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// Longest spelling first so "spring boot" wins over a shorter overlap.
const MATCHERS = SKILLS.map((skill) => ({
  name: skill.name,
  pattern: new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[skill.name, ...skill.variants]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  ),
}));

export function canonicalSkill(label: string): string | null {
  const wanted = label.trim().toLowerCase();
  for (const skill of SKILLS) {
    if (
      skill.name.toLowerCase() === wanted ||
      skill.variants.some((v) => v === wanted)
    ) {
      return skill.name;
    }
  }
  return null;
}

// Every dictionary skill mentioned in the text, with the index of the first mention.
export function findSkills(text: string): { name: string; index: number }[] {
  const found: { name: string; index: number }[] = [];
  for (const { name, pattern } of MATCHERS) {
    const match = pattern.exec(text);
    if (match) found.push({ name, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}
