package com.krbrief.ai;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface AiChatInteractionRepository extends JpaRepository<AiChatInteraction, Long> {
  List<AiChatInteraction> findTop20ByOrderByCreatedAtDesc();

  List<AiChatInteraction> findTop20ByStockCodeOrderByCreatedAtDesc(String stockCode);

  Optional<AiChatInteraction> findFirstByStockCodeAndResponseModeInOrderByCreatedAtDesc(
      String stockCode, List<String> responseModes);
}
