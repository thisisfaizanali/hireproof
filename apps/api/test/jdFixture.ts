import type { LlmScorecard } from "@hireproof/shared";

export const JD = [
  "Senior Java Developer",
  "Experience: 5 to 8 years",
  "Notice period: up to 60 days",
  "Budget: 18 to 26 LPA",
  "Location: Noida",
  "Must have: Java and Spring Boot",
  "Good to have: Kafka",
].join("\n");

export const VALID: LlmScorecard = {
  title: "Senior Java Developer",
  criteria: [
    { kind: "MUST_HAVE", label: "Java", sourceQuote: "Must have: Java" },
    {
      kind: "MUST_HAVE",
      label: "Spring Boot",
      sourceQuote: "Java and Spring Boot",
    },
    {
      kind: "NICE_TO_HAVE",
      label: "Kafka",
      sourceQuote: "Good to have: Kafka",
    },
  ],
  experience: { minYears: 5, maxYears: 8, sourceQuote: "5 to 8 years" },
  notice: { maxDays: 60, sourceQuote: "up to 60 days" },
  ctc: { maxLpa: 26, sourceQuote: "18 to 26 LPA" },
  locations: { values: ["Noida"], sourceQuote: "Location: Noida" },
  ambiguities: [],
};
