import { Navigate, Route, Routes } from 'react-router-dom';

import { CodingAgentPage } from './pages/CodingAgentPage.tsx';
import { ContributionTextPage } from './pages/ContributionTextPage.tsx';
import { DevCodingAgentChartsPage } from './pages/DevCodingAgentChartsPage.tsx';
import { DevVisualizationSelectorPage } from './pages/DevVisualizationSelectorPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { VisualizationPage } from './pages/VisualizationPage.tsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/attention" element={<ContributionTextPage />} />
      <Route path="/coding-agent" element={<CodingAgentPage />} />
      <Route path="/generate" element={<Navigate to="/" replace />} />
      <Route
        path="/dev/coding-agent-charts"
        element={
          import.meta.env.DEV ? (
            <DevCodingAgentChartsPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/dev/visualizations"
        element={
          import.meta.env.DEV ? (
            <DevVisualizationSelectorPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/visualizations/:visualizationId/:datasetId"
        element={<VisualizationPage />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
