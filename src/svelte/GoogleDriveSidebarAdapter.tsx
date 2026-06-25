import React, { useRef, useEffect, memo } from "react";
import { mount, unmount } from "svelte";
import GoogleDriveSidebar from "./GoogleDriveSidebar.svelte";

function useSvelteComponent(Component: any) {
  const ref = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    if (ref.current) {
      instanceRef.current = mount(Component, { target: ref.current });
    }
    return () => {
      if (instanceRef.current) {
        unmount(instanceRef.current);
        instanceRef.current = null;
      }
    };
  }, []);

  return ref;
}

export const SvelteGoogleDriveSidebar = memo(function SvelteGoogleDriveSidebar() {
  const ref = useSvelteComponent(GoogleDriveSidebar);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});