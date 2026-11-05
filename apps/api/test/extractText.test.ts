import { describe, expect, it } from "vitest";
import { ExtractError, extractText } from "../src/extract";
import { sample } from "./samples";

const read = (path: string) =>
  extractText(sample(path), path.split("/").pop()!);

describe("extractText", () => {
  it("reads a docx", async () => {
    expect(
      (await read("jds/Kestrel_Senior_Java_Developer_JD.docx")).text,
    ).toMatch(/Spring Boot/);
  });

  it("reads a pdf", async () => {
    expect(
      (await read("jds/Sahyadri_Finserv_KYC_Analyst_JD.pdf")).text,
    ).toMatch(/Notice period: up to 30 days/);
  });

  it("reads a txt", async () => {
    expect(
      (await read("jds/FW_ urgent requirement store ops manager.txt")).text,
    ).toMatch(/Store Operations Manager/);
  });

  it.each([
    ["edge/Vandana_Rawal_Resume.pdf", "unreadable"],
    ["edge/Tarun_Bedi_Resume_protected.pdf", "encrypted"],
    ["edge/Rajiv_Menon_CV.docx", "empty"],
    ["edge/Resume_Gaurav_Sethi.odt", "unsupported"],
  ])("rejects %s as %s", async (path, code) => {
    await expect(read(path)).rejects.toMatchObject({
      code,
      constructor: ExtractError,
    });
  });

  it("checks content, not just the extension", async () => {
    await expect(
      extractText(Buffer.from("plain words"), "resume.pdf"),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      extractText(Buffer.from([0, 1, 2, 3, 0, 0]), "resume.txt"),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});
