import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProctorProvider } from './sdk/ProctorProvider';
import { ExamPage } from './pages/ExamPage';
import { AdminPage } from './pages/AdminPage';
import { StudentDetail } from './pages/StudentDetail';

export default function App() {
  return (
    <BrowserRouter basename="/oxbridge">
      <ProctorProvider>
        <Routes>
          <Route path="/" element={<ExamPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/student/:sessionId" element={<StudentDetail />} />
        </Routes>
      </ProctorProvider>
    </BrowserRouter>
  );
}
