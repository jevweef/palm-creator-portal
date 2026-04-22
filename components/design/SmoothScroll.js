"use client";

import { useEffect } from "react";
import Lenis from "lenis";

export default function SmoothScroll() {
  useEffect(() => {
    // Disable smooth scroll on admin routes with heavy data tables
    if (typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path.startsWith("/admin/dashboard") || path.startsWith("/admin/creators") || path.startsWith("/admin/invoicing")) {
        return;
      }
    }

    const lenis = new Lenis({
      lerp: 0.08,
      smoothWheel: true,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  return null;
}
