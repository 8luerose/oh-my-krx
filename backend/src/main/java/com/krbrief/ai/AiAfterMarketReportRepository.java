package com.krbrief.ai;

import java.time.LocalDate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface AiAfterMarketReportRepository extends JpaRepository<AiAfterMarketReport, LocalDate> {}
