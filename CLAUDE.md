# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **semantic product search API** built with NestJS that uses OpenAI embeddings and PostgreSQL with pgvector for intelligent product search. The project includes a Next.js frontend for user interaction.

## Key Commands

### Backend Development
```bash
# Development
npm run start:dev      # Start with hot reload (port 4000)
npm run start:debug    # Start with debugger attached
npm run dev           # Start both backend and frontend concurrently

# Production
npm run build         # Build the application
npm run start:prod    # Start production server

# Code Quality
npm run lint          # Run ESLint
npm run format        # Format code with Prettier

# Testing
npm run test          # Run unit tests
npm run test:watch    # Run tests in watch mode
npm run test:cov      # Run tests with coverage
npm run test:e2e      # Run e2e tests
```

### Frontend Development (in frontend/ directory)
```bash
npm run dev           # Start development server (port 4001)
npm run build         # Build for production
npm run start         # Start production server
npm run lint          # Run linting
```

## Architecture Overview

### Core Technologies
- **Backend**: NestJS v11 with TypeScript
- **Frontend**: Next.js v15 with React 19
- **Database**: PostgreSQL with pgvector extension
- **AI/ML**: OpenAI API (text-embedding-3-large, GPT-4o)
- **Secondary DB**: MS SQL Server (for data migration)

### Module Structure
- **Search Module** (`src/search/`): Core semantic search with vector embeddings
- **Vision Module** (`src/vision.*`): Product image analysis using GPT-4o vision
- **Segments Module** (`src/segments/`): Brand segmentation logic
- **Acronimos Module** (`src/acronimos/`): Acronym expansion for search
- **Migration Module** (`src/migration/`): MS SQL to PostgreSQL data migration

### Key Implementation Patterns

1. **Database Connections**: Use connection pools with proper cleanup in `onModuleDestroy`
2. **Error Handling**: All async operations wrapped in try-catch with HTTP exceptions
3. **Timeouts**: External API calls use Promise.race() with 30-second timeouts
4. **Configuration**: Environment variables validated with Joi in ConfigModule
5. **Testing**: Jest with NestJS testing utilities, tests alongside source files (`.spec.ts`)

### Search Algorithm Flow
1. Convert query to embedding using OpenAI
2. Perform vector similarity search in PostgreSQL
3. Apply segment-based boost (premium: 1.3x, standard/economy: 1.2x)
4. If similarity < 0.5, normalize query with GPT-4o and retry
5. Use GPT-4o to select best product from top results

### Environment Variables
```bash
# Required
DATABASE_URL          # PostgreSQL connection string
OPENAI_API_KEY       # OpenAI API credentials

# Optional
PORT=4000            # Backend port
PORTF=4001           # Frontend port
VECTOR_DIMENSIONS=1024  # Embedding vector size
PGVECTOR_PROBES=15   # Search optimization parameter
ALLOWED_ORIGINS      # CORS allowed origins (comma-separated)

# Boost System Configuration (optional)
BOOST_SEGMENT_PREFERRED=1.30    # Boost for preferred segment (default 30%)
BOOST_SEGMENT_COMPATIBLE=1.20   # Boost for compatible segments (default 20%)
BOOST_STOCK=1.25                # Boost for products in stock (default 25%)
BOOST_COST_AGREEMENT=1.15       # Boost for cost agreements (default 15%)

# MS SQL (for migration)
MSSQL_USER
MSSQL_PASSWORD
MSSQL_SERVER
MSSQL_DATABASE

# Boost system configuration
BOOST_SEGMENT_PREFERRED=1.05   # Boost for exact segment match (default: 5%)
BOOST_SEGMENT_COMPATIBLE=1.03  # Boost for compatible segment (default: 3%)
BOOST_STOCK=1.10               # Boost for products with stock (default: 10%)
BOOST_COST_AGREEMENT=1.08      # Boost for products with cost agreements (default: 8%)

# Similarity classification thresholds (enterprise-grade for 1M+ products/month)
SIMILARITY_EXACTO_THRESHOLD=0.98      # Exact match threshold (default: 0.98)
SIMILARITY_EQUIVALENTE_THRESHOLD=0.94 # Equivalent function threshold (default: 0.94)
SIMILARITY_COMPATIBLE_THRESHOLD=0.88  # Compatible purpose threshold (default: 0.88)
SIMILARITY_ALTERNATIVO_THRESHOLD=0.82 # Alternative option threshold (default: 0.82)
```

### API Endpoints
- `POST /search` - Main search endpoint (body: `{ query: string, segmento?: string }`)
- `GET /webhook/:id` - Legacy webhook support for n8n
- `POST /vision/analyze` - Analyze product images

### Database Schema Requirements
- PostgreSQL with pgvector extension enabled
- Tables must have `embedding` column of type `vector(1024)`
- Recommended indexes: `ivfflat` on embedding columns

### Development Tips
- Always check existing patterns in neighboring files before implementing new features
- Use the established error handling pattern with try-catch and proper HTTP status codes
- Follow the modular architecture - each feature should be its own module
- Maintain the service/controller separation of concerns
- When adding new endpoints, follow the existing REST patterns
- For database operations, always use the connection pool pattern with proper cleanup