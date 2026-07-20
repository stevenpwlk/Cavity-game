"use client";

import { useActionState } from "react";
import { loginAction, type AuthActionState } from "@/lib/auth-actions";

const initialState: AuthActionState = { status: "idle" };

export default function ConnexionPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="phone-shell">
      <div
        className="phone"
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 24,
          textAlign: "center"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.24em", color: "var(--argent-sombre)" }}>
            F.I.S.T. — CENTRE D&apos;ENTRAÎNEMENT OFFICIEL
          </span>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "0.08em" }}>CAVITY GAME</h1>
        </div>

        <form
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 300 }}
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state.status === "error" ? (
            <p style={{ fontSize: 12, color: "#e78a72" }}>{state.message}</p>
          ) : null}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "CONNEXION…" : "SE CONNECTER"}
          </button>
        </form>

        <p style={{ fontSize: 11, color: "var(--argent)", maxWidth: "30ch", lineHeight: 1.6 }}>
          Mêmes identifiants que l&apos;application de pronostics de la Coupe du monde de Trounis.
        </p>
      </div>
    </div>
  );
}
