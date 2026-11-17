import { render, screen } from '@testing-library/react';
import App from './app/App';

test('renders the existing Chess Olympics welcome theme and sign-in action', () => {
  render(<App />);
  const linkElement = screen.getAllByRole('button', {name:/sign in/i})[0];
  expect(linkElement).toBeInTheDocument();
});
