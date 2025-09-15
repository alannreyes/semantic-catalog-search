import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'logs' })
export class LogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamp' })
  fecha: Date;

  @Column({ type: 'varchar', length: 32 })
  endpoint: string;

  @Column({ type: 'jsonb' })
  body: any;

  @Column({ type: 'jsonb' })
  resultado: any;
}
