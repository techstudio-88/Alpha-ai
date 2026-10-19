"use client";

import {useEffect} from "react";

const REVEAL_SELECTOR = [
  ".landing-section",
  ".formats-strip",
  ".final-cta",
  ".how-card",
  ".bento-card",
  ".quality-node",
  ".pricing-card",
  ".usecase-panel",
  ".before-after",
  ".faq-list details",
  ".assistant-showcase",
  ".landing-footer .footer-grid > div",
].join(",");

export default function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const isPaused = () => reduced.matches || root.dataset.motion === "paused";
    const nodes = [...document.querySelectorAll(REVEAL_SELECTOR)];
    if (isPaused()) {
      nodes.forEach((node) => node.classList.add("is-in-view"));
      return;
    }

    root.classList.add("landing-motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in-view");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });

    nodes.forEach((node, index) => {
      node.classList.add("motion-reveal");
      node.style.setProperty("--reveal-delay", `${Math.min(index % 5, 4) * 75}ms`);
      observer.observe(node);
    });

    const tiltCards = [...document.querySelectorAll(".landing-container .how-card, .landing-container .bento-card, .landing-container .pricing-card, .landing-container .quality-node")];
    const cleanups = [];
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      tiltCards.forEach((card) => {
        const move = (event) => {
          if (isPaused()) return;
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;
          card.style.setProperty("--card-rotate-x", `${(0.5 - y) * 4}deg`);
          card.style.setProperty("--card-rotate-y", `${(x - 0.5) * 5}deg`);
          card.style.setProperty("--card-glow-x", `${x * 100}%`);
          card.style.setProperty("--card-glow-y", `${y * 100}%`);
        };
        const reset = () => {
          card.style.setProperty("--card-rotate-x", "0deg");
          card.style.setProperty("--card-rotate-y", "0deg");
        };
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerleave", reset);
        cleanups.push(() => {
          card.removeEventListener("pointermove", move);
          card.removeEventListener("pointerleave", reset);
        });
      });
    }

    const syncMotion = () => {
      if (!isPaused()) return;
      nodes.forEach((node) => node.classList.add("is-in-view"));
      root.classList.remove("landing-motion-ready");
      tiltCards.forEach((card) => {
        card.style.setProperty("--card-rotate-x", "0deg");
        card.style.setProperty("--card-rotate-y", "0deg");
      });
    };
    root.addEventListener("alpha:motion", syncMotion);
    reduced.addEventListener?.("change", syncMotion);
    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      root.removeEventListener("alpha:motion", syncMotion);
      reduced.removeEventListener?.("change", syncMotion);
      root.classList.remove("landing-motion-ready");
    };
  }, []);

  return null;
}
