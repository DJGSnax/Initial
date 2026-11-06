import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Toaster, Loading } from "./ui";
import { HelpLayout } from "./help/HelpLayout";
import { HelpHome } from "./help/HelpHome";
import { HelpCollection } from "./help/HelpCollection";
import { HelpArticle } from "./help/HelpArticle";
import { HelpSearch } from "./help/HelpSearch";

const AdminApp = lazy(() => import("./admin/AdminApp"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/help" element={<HelpLayout />}>
          <Route index element={<HelpHome />} />
          <Route path="search" element={<HelpSearch />} />
          <Route path="c/:slug" element={<HelpCollection />} />
          <Route path="a/:slug" element={<HelpArticle />} />
        </Route>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<div className="p-10"><Loading /></div>}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/help" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
);
