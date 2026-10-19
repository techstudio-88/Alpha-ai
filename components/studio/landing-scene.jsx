"use client";

import { useEffect, useRef } from "react";

/**
 * Optional Three.js atmosphere for the landing hero.
 * The existing CSS/DOM hero artwork remains visible as the static fallback.
 */
export default function LandingScene() {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const lowMemory = typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
    const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
    if (motionQuery.matches || connection?.saveData || lowMemory || lowCpu) return undefined;

    let disposed = false;
    let frame = 0;
    let renderer;
    let resizeHandler;
    let scene;
    let camera;
    let meshes = [];

    import("three").then((THREE) => {
      if (disposed || !host.isConnected) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: !(connection?.effectiveType === "2g"),
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.z = 7;

        const ambient = new THREE.AmbientLight(0xffffff, 1.7);
        scene.add(ambient);
        const violet = new THREE.PointLight(0x8b5cf6, 22, 18);
        violet.position.set(-2.4, 1.8, 2);
        scene.add(violet);
        const cyan = new THREE.PointLight(0x22d3ee, 16, 18);
        cyan.position.set(2.5, -1.2, 1);
        scene.add(cyan);

        const geometry = new THREE.IcosahedronGeometry(0.85, 1);
        const materials = [
          new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: 0.55, roughness: 0.28, wireframe: true, transparent: true, opacity: 0.75 }),
          new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.35, roughness: 0.32, wireframe: true, transparent: true, opacity: 0.55 }),
          new THREE.MeshStandardMaterial({ color: 0xc4b5fd, metalness: 0.45, roughness: 0.25, wireframe: true, transparent: true, opacity: 0.5 }),
        ];
        meshes = materials.map((material, index) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set((index - 1) * 1.9, index === 1 ? -0.35 : 0.25, index === 1 ? -0.6 : 0);
          mesh.scale.setScalar(index === 1 ? 0.72 : 0.88);
          scene.add(mesh);
          return mesh;
        });

        host.appendChild(canvas);
        resizeHandler = () => {
          const rect = host.getBoundingClientRect();
          const width = Math.max(1, rect.width);
          const height = Math.max(1, rect.height);
          camera.aspect = width / height;
          camera.position.x = width < 520 ? 0 : 0.15;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resizeHandler();
        window.addEventListener("resize", resizeHandler, { passive: true });

        const animate = () => {
          if (disposed) return;
          const t = performance.now() * 0.00018;
          meshes.forEach((mesh, index) => {
            mesh.rotation.x = t * (index % 2 ? -0.7 : 0.55);
            mesh.rotation.y = t * (index % 2 ? 0.8 : -0.65);
          });
          renderer.render(scene, camera);
          frame = window.requestAnimationFrame(animate);
        };
        animate();
      } catch {
        renderer?.dispose();
        host.querySelector("canvas")?.remove();
      }
    }).catch(() => {
      // No WebGL or a failed Three.js chunk: keep the static hero artwork.
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      meshes.forEach((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      renderer?.dispose();
      host.querySelector("canvas")?.remove();
    };
  }, []);

  return <div ref={hostRef} className="landing-scene-canvas" aria-hidden="true" />;
}
