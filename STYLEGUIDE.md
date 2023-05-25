STYLEGUIDE.md
Introduction
This document outlines the coding style, practices, and conventions used in our project. It is crucial for maintaining readability and consistency throughout the codebase. We encourage every contributor to familiarize themselves with this guide before starting to work on the project.

1. General Guidelines
Follow the principle of "Code as Documentation". Write clean, readable code that expresses the intent behind the program logic.
Use meaningful, descriptive names for variables, functions, components, and other code entities.
Comments should be used to explain the 'why' and not the 'what'. The code itself should be self-explanatory.
Each file should have a single purpose or theme. If a file gets too large or serves multiple purposes, consider breaking it into smaller files.
Opt for simplicity and clarity when writing your code. Avoid clever or tricky solutions when straightforward ones will do.
2. TypeScript Guidelines
Use TypeScript's static typing whenever possible. Avoid using the any type unless absolutely necessary.
Follow the naming conventions: camelCase for variables and functions, PascalCase for classes and interfaces.
Use const for variables that won't be reassigned, and let for those that will. Avoid var.
Prefer arrow functions over traditional function expressions.
Make use of TypeScript's access modifiers (public, private, protected) and readonly status where applicable.
3. React Guidelines
Use functional components and hooks.
Keep components small and focused. Each component should have a single responsibility.
Avoid complex and nested ternary operations in JSX.
Always define propTypes and default props for all components.
Use React's context API for state management across components.
Use React Navigation for routing and navigation in the app.
4. Expo Guidelines
Keep the code compatible with Android, iOS, and Web.
Use Expo's built-in APIs and services whenever possible for cross-platform compatibility.
Test your code frequently on different platforms.
5. Code Formatting
Follow the Prettier configuration for automatic code formatting. Use the .prettierrc file in the root directory of the project to set Prettier options.
Use 2 spaces for indentation.
Use single quotes for strings.
Include a space before the opening bracket of a block.
6. Frontend/Backend integration.
Updating the local state immediately when the user interacts with the UI, and then sending these changes to the backend. Once the backend confirms that it has saved the changes, the frontend can consider these changes "committed". If the backend indicates an error (e.g., the changes were invalid or couldn't be saved), the frontend should roll back its local state to match the backend.
6. Git Practices
Make frequent, smaller commits instead of infrequent, larger ones. Each commit should represent a single logical change.
Write descriptive commit messages that explain what changes were made and why.
Use feature branches for developing new features or fixing bugs. Merge them back into the main branch using pull requests.
7. Testing
Write unit tests for your functions and components.
Use Jest for testing, along with testing-library/react for React components.
Each new feature should be accompanied by tests that cover the main functionality.
Conclusion
It's important to remember that this guide is a living document. As we learn and grow as a team, we'll update this guide to reflect new insights and better practices. The ultimate goal is to create a codebase that is consistent, readable, and easy to maintain for everyone on the team.
END OF STYLEGUIDE