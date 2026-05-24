import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('lightning_strikes')
@Index(['occurrenceDate'])
@Index(['latitude', 'longitude'])
@Unique(['latitude', 'longitude', 'occurrenceDate'])
export class LightningStrike {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('decimal', { precision: 10, scale: 7 })
  latitude!: number;

  @Column('decimal', { precision: 10, scale: 7 })
  longitude!: number;

  @Column({ type: 'timestamp' })
  occurrenceDate!: Date;

  @Column({ type: 'int' })
  weatherCode!: number;

  @Column({ type: 'float', nullable: true, comment: 'Intensidade em kA (kiloamperes)' })
  intensity!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
