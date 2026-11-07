import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db";
import type { ApplicationStage } from "../src/generated/prisma/client";
import { PASSWORD } from "./helpers";

const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export async function cookieFor(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// A client company with a hiring manager who can sign in.
export async function createClient(name: string, hmEmail: string) {
  const client = await prisma.client.create({
    data: { name, industry: "IT_SERVICES" },
  });
  const user = await prisma.user.create({
    data: {
      email: hmEmail,
      name: `${name} manager`,
      role: "CLIENT_HM",
      passwordHash,
      clientId: client.id,
    },
  });
  return { client, user, cookie: await cookieFor(hmEmail) };
}

export async function createStaff(
  role: "RECRUITER" | "DELIVERY_HEAD",
  email: string,
) {
  const user = await prisma.user.create({
    data: { email, name: `Test ${role}`, role, passwordHash },
  });
  return { user, cookie: await cookieFor(email) };
}

export const openRequisition = (
  clientId: string,
  ownerId: string,
  title = "Senior Java Developer",
) =>
  prisma.requisition.create({
    data: {
      clientId,
      ownerId,
      title,
      jdText: "A job description.",
      status: "OPEN",
      scorecard: {
        create: {
          source: "MANUAL",
          status: "CONFIRMED",
          version: 1,
          criteria: {
            create: [
              { kind: "MUST_HAVE", label: "Java", position: 0 },
              { kind: "NICE_TO_HAVE", label: "Kafka", position: 1 },
            ],
          },
        },
      },
    },
  });

export const PHONE = "9876543011";
export const EMAIL = "riya.sen@example.org";

// A candidate with a CV that carries an email, a phone and personal fields,
// an application at the given stage and a stored score.
export async function candidateAt(
  requisitionId: string,
  recruiterId: string,
  stage: ApplicationStage,
  name = "Riya Sen",
  extra: { submittedAt?: Date; note?: string } = {},
) {
  const candidate = await prisma.candidate.create({
    data: {
      name,
      email: EMAIL,
      phone: PHONE,
      currentRole: "Backend Engineer",
      location: "Noida",
      totalExperienceYears: 6.5,
      noticeText: "30 days",
      noticeDays: 30,
      skills: ["Java", "Spring Boot"],
    },
  });
  const batch = await prisma.uploadBatch.create({
    data: { requisitionId, uploadedById: recruiterId, expectedCount: 1 },
  });
  const text = [
    name.toUpperCase(),
    `Email: ${EMAIL} | Phone: +91 98765 43011`,
    "Date of Birth: 12 March 1994",
    "Marital Status: Single",
    "",
    "EXPERIENCE",
    `Backend Engineer at Cobalt Digital. ${name} built REST APIs in Spring Boot.`,
    "",
    "EDUCATION",
    "B.Tech, Computer Science, 2016",
  ].join("\n");
  const cv = await prisma.cvDocument.create({
    data: {
      batchId: batch.id,
      requisitionId,
      candidateId: candidate.id,
      fileName: `${name}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 3,
      sha256: `${candidate.id}`,
      data: new Uint8Array([1, 2, 3]),
      text,
      redactedText: text
        .replace(EMAIL, "[email]")
        .replace("+91 98765 43011", "[phone]"),
      status: "PARSED",
    },
  });
  const application = await prisma.application.create({
    data: {
      candidateId: candidate.id,
      requisitionId,
      stage,
      ...(stage !== "SOURCED" &&
        stage !== "SCREENED" && {
          submittedAt: extra.submittedAt ?? new Date(),
          submittedById: recruiterId,
          submissionNote:
            extra.note ??
            "Six years on Spring Boot services, led a payments migration, and can join in a month.",
        }),
    },
  });
  await prisma.candidateScore.create({
    data: {
      applicationId: application.id,
      scorecardVersion: 1,
      total: 82,
      band: "STRONG",
      mustHavesMet: 1,
      mustHavesTotal: 1,
      experiencePoints: 10,
      criteria: [
        {
          id: "c1",
          label: "Java",
          kind: "MUST_HAVE",
          verdict: "MET",
          quotes: [
            {
              text: `[name] built REST APIs in Spring Boot, reach me on ${EMAIL}`,
              verified: true,
            },
            { text: "an invented quote", verified: false },
          ],
          points: 80,
          maxPoints: 80,
          flag: null,
        },
        {
          id: "c2",
          label: "Kafka",
          kind: "NICE_TO_HAVE",
          verdict: "NOT_FOUND",
          quotes: [],
          points: 0,
          maxPoints: 10,
          flag: null,
        },
      ],
      flags: [
        "Notice 90 days, role allows 60.",
        "Scored without AI. Check the evidence before relying on it.",
      ],
      source: "RULES",
    },
  });
  return { candidate, cv, application };
}

export const get = (cookie: string, path: string) =>
  request(app).get(path).set("Cookie", cookie);
export const post = (cookie: string, path: string, body: object = {}) =>
  request(app).post(path).set("Cookie", cookie).send(body);
