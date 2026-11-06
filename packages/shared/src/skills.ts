// Canonical skill names with the spellings seen in job descriptions and CVs.
// Matching is case-insensitive and respects word boundaries, except for names
// marked `exact`, which are also common words and must match as written.
export const SKILLS: { name: string; variants: string[]; exact?: true }[] = [
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
  { name: "Kotlin", variants: [] },
  { name: "Android SDK", variants: ["android"] },
  { name: "Jetpack Compose", variants: [] },
  { name: "MVVM", variants: [] },
  { name: "Retrofit", variants: [] },
  { name: "Firebase", variants: [] },
  { name: "Room", variants: [], exact: true },
  { name: "C#", variants: ["c sharp"] },
  { name: ".NET Core", variants: ["dotnet core", ".net"] },
  { name: "ASP.NET MVC", variants: ["asp.net"] },
  { name: "Web API", variants: ["asp.net web api"] },
  {
    name: "SQL Server",
    variants: ["mssql", "ms sql server", "microsoft sql server"],
  },
  { name: "Entity Framework", variants: ["ef core"] },
  { name: "Azure DevOps", variants: [] },
  { name: "OOP", variants: ["oops", "object oriented programming"] },
  { name: "JDBC", variants: [] },
  { name: "HTML", variants: ["html5"] },
  { name: "CSS", variants: ["css3"] },
  { name: "Jira", variants: [] },
  { name: "Postman", variants: [] },
  { name: "Swagger", variants: ["openapi"] },
  { name: "Spring Cloud Gateway", variants: [] },
  { name: "OpenTelemetry", variants: [] },
  { name: "Gradle", variants: [] },
  { name: "Struts", variants: [] },
  { name: "JSP", variants: [] },
  { name: "Servlets", variants: ["servlet"] },
  { name: "SOAP", variants: [] },
  { name: "Ansible", variants: [] },
  { name: "Elasticsearch", variants: ["elastic search"] },
  { name: "Go", variants: ["golang"], exact: true },
  { name: "Scala", variants: [] },
  { name: "GraphQL", variants: [] },
  { name: "Prometheus", variants: [] },
  { name: "Grafana", variants: [] },
  { name: "Selenium", variants: [] },
  { name: "Machine Learning", variants: [] },
  { name: "TestNG", variants: [] },
  { name: "RestAssured", variants: ["rest assured"] },
  { name: "Django", variants: [] },
  { name: "FastAPI", variants: [] },
  { name: "Flask", variants: [] },
  { name: "pandas", variants: [] },
  { name: "Airflow", variants: ["apache airflow"] },
  { name: "SonarQube", variants: [] },
  { name: "Domain Driven Design", variants: ["domain-driven design"] },
  { name: "Solution Architecture", variants: ["solution architect"] },
  { name: "Periodic review", variants: ["periodic kyc refresh"] },
  { name: "Customer risk rating", variants: ["risk rating"] },
  { name: "Retail banking operations", variants: ["retail banking"] },
  { name: "Account opening", variants: [] },
  { name: "Transaction alerts", variants: [] },
  { name: "Cash reporting", variants: [] },
  { name: "Finacle", variants: [] },
  { name: "Customer service", variants: [] },
  { name: "CRM tools", variants: ["crm"] },
  { name: "Complaint handling", variants: [] },
  { name: "Case documentation", variants: ["case writing"] },
  { name: "Loan processing", variants: [] },
  { name: "Bureau report reading", variants: [] },
  { name: "LOS software", variants: ["los"] },
  { name: "Merchant onboarding", variants: [] },
  { name: "FATCA/CRS", variants: ["fatca"] },
  { name: "Audit readiness", variants: [] },
  { name: "Process design", variants: [] },
  { name: "Customer escalations", variants: [] },
  { name: "Stock audit", variants: ["stock audits", "stock takes"] },
  { name: "MS Office", variants: ["microsoft office"] },
  { name: "Store audits", variants: [] },
  { name: "Budgeting", variants: [] },
  { name: "Vendor negotiation", variants: [] },
  { name: "Guest service", variants: ["guest services"] },
  { name: "Front office", variants: [] },
  { name: "Housekeeping", variants: [] },
  { name: "Event coordination", variants: [] },
  { name: "Warehouse operations", variants: [] },
  { name: "3PL management", variants: ["3pl"] },
  { name: "Cost control", variants: [] },
  { name: "WMS", variants: [] },
  { name: "Floor management", variants: [] },
  { name: "Stock receiving", variants: [] },
  { name: "Statutory compliance", variants: [] },
  { name: "Sales targets", variants: [] },
  { name: "Adobe Illustrator", variants: ["illustrator"] },
  { name: "Photoshop", variants: ["adobe photoshop"] },
  { name: "InDesign", variants: ["adobe indesign"] },
  { name: "Figma", variants: [] },
  { name: "Brand identity", variants: [] },
  { name: "Typography", variants: [] },
  { name: "Motion graphics", variants: [] },
  { name: "AutoCAD", variants: ["auto cad"] },
  { name: "Quantity surveying", variants: [] },
  { name: "Site execution", variants: [] },
  { name: "Quality control", variants: [] },
  { name: "MS Project", variants: ["microsoft project"] },
  { name: "SolidWorks", variants: ["solid works"] },
  { name: "GD&T", variants: [] },
  { name: "Sheet metal design", variants: [] },
  { name: "BOM management", variants: ["bom"] },
  { name: "FEA", variants: [] },
  { name: "Tally", variants: [] },
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
    skill.exact ? "u" : "iu",
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
