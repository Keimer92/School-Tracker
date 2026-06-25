import React, { useRef, useEffect, memo } from "react";
import { mount, unmount } from "svelte";
import AsistenciaPageSvelte from "./AsistenciaPage.svelte";
import EvaluacionesPageSvelte from "./EvaluacionesPage.svelte";
import InformePageSvelte from "./InformePage.svelte";
import NotasPageSvelte from "./NotasPage.svelte";
import ReportesPageSvelte from "./ReportesPage.svelte";
import EstudiantesPageSvelte from "./EstudiantesPage.svelte";
import GlobalesPageSvelte from "./GlobalesPage.svelte";
import AjustesPageSvelte from "./AjustesPage.svelte";

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

export const SvelteAsistenciaPage = memo(function SvelteAsistenciaPage() {
  const ref = useSvelteComponent(AsistenciaPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteEvaluacionesPage = memo(function SvelteEvaluacionesPage() {
  const ref = useSvelteComponent(EvaluacionesPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteInformePage = memo(function SvelteInformePage() {
  const ref = useSvelteComponent(InformePageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteNotasPage = memo(function SvelteNotasPage() {
  const ref = useSvelteComponent(NotasPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteReportesPage = memo(function SvelteReportesPage() {
  const ref = useSvelteComponent(ReportesPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteEstudiantesPage = memo(function SvelteEstudiantesPage() {
  const ref = useSvelteComponent(EstudiantesPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteGlobalesPage = memo(function SvelteGlobalesPage() {
  const ref = useSvelteComponent(GlobalesPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});

export const SvelteAjustesPage = memo(function SvelteAjustesPage() {
  const ref = useSvelteComponent(AjustesPageSvelte);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
});
