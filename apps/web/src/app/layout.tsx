import type { Metadata } from "next";
import { Red_Hat_Display, Red_Hat_Mono, Red_Hat_Text } from "next/font/google";
import "./globals.css";

const display = Red_Hat_Display({
  subsets: ["latin"],
  variable: "--font-red-hat-display",
});
const text = Red_Hat_Text({
  subsets: ["latin"],
  variable: "--font-red-hat-text",
});
const mono = Red_Hat_Mono({
  subsets: ["latin"],
  variable: "--font-red-hat-mono",
});

export const metadata: Metadata = {
  title: { default: "Hireproof", template: "%s | Hireproof" },
  description:
    "Resume screening for staffing teams, with every score tied to evidence from the CV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
