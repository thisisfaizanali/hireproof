"use client";

import { useEffect, useState } from "react";
import { HealthResponse } from "@hireproof/shared";

export default function Home() {
  const [result, setResult] = useState("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => HealthResponse.parse(body))
      .then((health) => setResult(`status: ${health.status}, db: ${health.db}`))
      .catch(() => setResult("api unreachable"));
  }, []);

  return (
    <main className="p-4">
      <h1>Hireproof</h1>
      <p>{result}</p>
    </main>
  );
}
