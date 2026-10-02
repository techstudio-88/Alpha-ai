"use client";

import { useEffect, useState } from "react";

export default function OnboardingWelcome({ onStart }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 1450);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="alphaWelcome" role="dialog" aria-modal="true" aria-labelledby="alphaWelcomeTitle">
      <div className="alphaWelcomeBackdrop" />
      <div className="alphaWelcomeGlow alphaWelcomeGlowOne" />
      <div className="alphaWelcomeGlow alphaWelcomeGlowTwo" />

      <div className="alphaWelcomeInner">
        <div className={"alphaWelcomeLogoStage " + (revealed ? "isRevealed" : "")}>
          <div className="alphaWelcomeHalo" />
          <img
            className="alphaWelcomeLogo"
            src="/alpha-onboarding-logo.png"
            alt="Alpha.ai"
            draggable="false"
          />
          <div className="alphaWelcomeShine" />
        </div>

        <div className="alphaWelcomeCopy">
          <div className="alphaWelcomeEyebrow">WELCOME TO ALPHA.AI</div>
          <h1 id="alphaWelcomeTitle">Your content workspace is ready.</h1>
          <p>
            Let&apos;s take a few seconds to personalize Alpha.ai before you enter your workspace.
          </p>
        </div>

        <button className="alphaWelcomeStart" type="button" onClick={onStart}>
          <span>Start</span>
          <span className="alphaWelcomeArrow">→</span>
        </button>

        <div className="alphaWelcomeHint">Workspace setup · about 30 seconds</div>
      </div>
    </div>
  );
}
